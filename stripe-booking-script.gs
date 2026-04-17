// ═══════════════════════════════════════════════════════════════════
// Evergreen Lawn Care — Stripe Booking Script
// ───────────────────────────────────────────────────────────────────
// Handles everything in one deployed Web App:
//   POST  → create Stripe Customer + Setup Checkout Session
//   GET ?action=confirm  → verify card saved, log to Sheets + Calendar
//   GET ?action=list     → return confirmed bookings for charge.html
//   GET ?action=charge   → charge a saved card after the job
//
// SETUP:
//   1. Paste your Stripe SECRET key into STRIPE_SECRET_KEY below
//   2. Set CHARGE_PAGE_PASSWORD to something only you know
//   3. Confirm SHEET_ID matches your Google Sheet
//   4. Enable Calendar API: Services → + → Google Calendar API → Add
//   5. Deploy → New deployment → Web app
//      Execute as: Me | Who has access: Anyone
//   6. Copy the deployed URL into index.html as BOOKING_SCRIPT_URL
// ═══════════════════════════════════════════════════════════════════

const STRIPE_SECRET_KEY    = 'sk_live_PASTE_YOUR_STRIPE_SECRET_KEY_HERE';
const SHEET_ID             = '1rLSiMz104IQU7r9Iub1QUu2KOjv7He-0mMr-XeCzxSY';
const YOUR_SITE_URL        = 'https://evergreenlawncareflorida.com';
const CHARGE_PAGE_PASSWORD = 'evergreen2025'; // ← change this to something private

const PENDING_TAB   = 'Pending Bookings';
const CONFIRMED_TAB = 'Confirmed Bookings';


// ───────────────────────────────────────────────────────────────────
// POST — called from booking form in index.html
// Body (JSON): { name, email, phone, address, zip, service, price,
//               frequency, serviceDateRaw, serviceDate, notes }
// Returns: { checkoutUrl } or { error }
// ───────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 1. Create Stripe Customer
    const customer = stripeRequest('POST', 'customers', {
      name:  data.name,
      email: data.email,
      phone: data.phone || '',
      'metadata[address]': data.address || '',
      'metadata[zip]':     data.zip     || '',
    });

    // 2. Store pending booking in sheet (before redirect, so nothing is lost)
    storePendingBooking(customer.id, data);

    // 3. Create Stripe Checkout Session — setup mode (saves card, $0 charged now)
    const successUrl = YOUR_SITE_URL + '/booking-success.html?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl  = YOUR_SITE_URL + '/#services';

    const session = stripeRequest('POST', 'checkout/sessions', {
      customer:                    customer.id,
      mode:                        'setup',
      'payment_method_types[]':    'card',
      success_url:                 successUrl,
      cancel_url:                  cancelUrl,
      'metadata[customerName]':    data.name,
      'metadata[serviceDate]':     data.serviceDate || '',
    });

    return jsonResponse({ checkoutUrl: session.url });

  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}


// ───────────────────────────────────────────────────────────────────
// GET — routes to sub-actions via ?action=
// ───────────────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();

  try {
    if (action === 'confirm') return handleConfirm(e.parameter.session_id);
    if (action === 'list')    return handleList(e.parameter.password);
    if (action === 'charge')  return handleCharge(
      e.parameter.booking_id,
      e.parameter.amount,
      e.parameter.password
    );
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}


// ───────────────────────────────────────────────────────────────────
// CONFIRM — verify Stripe session, promote pending → confirmed
// ───────────────────────────────────────────────────────────────────
function handleConfirm(sessionId) {
  if (!sessionId) return jsonResponse({ error: 'Missing session_id' });

  // Verify with Stripe that the session is complete
  const session = stripeRequest('GET', 'checkout/sessions/' + sessionId, {});
  if (session.status !== 'complete') {
    return jsonResponse({ error: 'Session not complete yet', status: session.status });
  }

  const customerId = session.customer;

  // Retrieve pending booking
  const pending = getPendingBooking(customerId);
  if (!pending) {
    return jsonResponse({ error: 'Pending booking not found for this customer' });
  }

  // Log to Confirmed sheet + create Calendar event
  const bookingId = logConfirmedBooking(pending, customerId);
  createCalendarEvent(pending);
  markPendingConfirmed(pending.rowIndex);

  return jsonResponse({
    success:     true,
    name:        pending.name,
    serviceDate: pending.serviceDate,
    service:     pending.service,
    bookingId:   bookingId,
  });
}


// ───────────────────────────────────────────────────────────────────
// LIST — return confirmed bookings for charge.html
// ───────────────────────────────────────────────────────────────────
function handleList(password) {
  if (password !== CHARGE_PAGE_PASSWORD) {
    return jsonResponse({ error: 'Wrong password' });
  }

  const sheet = getConfirmedSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return jsonResponse({ bookings: [] });

  const headers  = rows[0];
  const bookings = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  return jsonResponse({ bookings });
}


// ───────────────────────────────────────────────────────────────────
// CHARGE — charge a customer's saved card after the job
// ───────────────────────────────────────────────────────────────────
function handleCharge(bookingId, amountDollars, password) {
  if (password !== CHARGE_PAGE_PASSWORD) {
    return jsonResponse({ error: 'Wrong password' });
  }
  if (!bookingId || !amountDollars) {
    return jsonResponse({ error: 'Missing booking_id or amount' });
  }

  // Find booking row
  const sheet  = getConfirmedSheet();
  const rows   = sheet.getDataRange().getValues();
  const headers = rows[0];
  const colIdx  = (name) => headers.indexOf(name);

  let targetRow = -1;
  let rowData   = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][colIdx('Booking ID')] === bookingId) {
      targetRow = i + 1; // 1-indexed for sheet range
      rowData   = rows[i];
      break;
    }
  }

  if (!rowData) return jsonResponse({ error: 'Booking not found: ' + bookingId });

  const chargeStatus = rowData[colIdx('Charge Status')];
  if (chargeStatus === 'Charged ✓') {
    return jsonResponse({ error: 'Already charged' });
  }

  const customerId = rowData[colIdx('Stripe Customer ID')];
  const email      = rowData[colIdx('Email')];
  const name       = rowData[colIdx('Name')];
  const service    = rowData[colIdx('Service')];
  const serviceDate = rowData[colIdx('Service Date')];

  // Get the customer's saved payment method
  const pmList = stripeRequest('GET',
    'customers/' + customerId + '/payment_methods?type=card&limit=1', {});

  if (!pmList.data || pmList.data.length === 0) {
    return jsonResponse({ error: 'No card on file for this customer' });
  }
  const pmId  = pmList.data[0].id;
  const cents = Math.round(parseFloat(amountDollars) * 100);

  // Create + confirm Payment Intent (off-session charge)
  const intent = stripeRequest('POST', 'payment_intents', {
    amount:          cents,
    currency:        'usd',
    customer:        customerId,
    payment_method:  pmId,
    confirm:         'true',
    off_session:     'true',
    description:     service + ' – ' + name + ' – ' + serviceDate,
    receipt_email:   email,
  });

  if (intent.status === 'succeeded') {
    // Update Confirmed sheet
    sheet.getRange(targetRow, colIdx('Charge Status') + 1).setValue('Charged ✓');
    sheet.getRange(targetRow, colIdx('Charged At')    + 1).setValue(
      new Date().toLocaleString('en-US')
    );
    return jsonResponse({ success: true, amount: amountDollars, name });
  } else {
    return jsonResponse({ error: 'Payment failed with status: ' + intent.status });
  }
}


// ═══════════════════════════════════════════════════════════════════
// SHEET HELPERS
// ═══════════════════════════════════════════════════════════════════

function getOrCreateSheet(tabName, headers) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function getPendingSheet() {
  return getOrCreateSheet(PENDING_TAB, [
    'Stripe Customer ID', 'Name', 'Email', 'Phone', 'Address', 'Zip',
    'Service', 'Price', 'Frequency', 'Service Date Raw', 'Service Date',
    'Notes', 'Created At', 'Status'
  ]);
}

function getConfirmedSheet() {
  return getOrCreateSheet(CONFIRMED_TAB, [
    'Booking ID', 'Name', 'Email', 'Phone', 'Address', 'Zip',
    'Service', 'Price', 'Frequency', 'Service Date Raw', 'Service Date',
    'Notes', 'Confirmed At', 'Stripe Customer ID', 'Charge Status', 'Charged At'
  ]);
}

function storePendingBooking(customerId, data) {
  getPendingSheet().appendRow([
    customerId,
    data.name, data.email, data.phone || '', data.address, data.zip,
    data.service, data.price, data.frequency,
    data.serviceDateRaw, data.serviceDate,
    data.notes || '(none)',
    new Date().toLocaleString('en-US'),
    'Pending Card'
  ]);
}

function getPendingBooking(customerId) {
  const sheet = getPendingSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === customerId && rows[i][13] === 'Pending Card') {
      return {
        rowIndex:       i + 1,
        customerId:     rows[i][0],
        name:           rows[i][1],
        email:          rows[i][2],
        phone:          rows[i][3],
        address:        rows[i][4],
        zip:            rows[i][5],
        service:        rows[i][6],
        price:          rows[i][7],
        frequency:      rows[i][8],
        serviceDateRaw: rows[i][9],
        serviceDate:    rows[i][10],
        notes:          rows[i][11],
      };
    }
  }
  return null;
}

function logConfirmedBooking(pending, customerId) {
  const bookingId = 'bk_' + Date.now();
  getConfirmedSheet().appendRow([
    bookingId,
    pending.name, pending.email, pending.phone,
    pending.address, pending.zip,
    pending.service, pending.price, pending.frequency,
    pending.serviceDateRaw, pending.serviceDate,
    pending.notes,
    new Date().toLocaleString('en-US'),
    customerId,
    'Not Charged', ''
  ]);
  return bookingId;
}

function markPendingConfirmed(rowIndex) {
  getPendingSheet().getRange(rowIndex, 14).setValue('Confirmed ✓');
}


// ═══════════════════════════════════════════════════════════════════
// CALENDAR HELPER
// ═══════════════════════════════════════════════════════════════════

function createCalendarEvent(pending) {
  try {
    const parts = pending.serviceDateRaw.split('-').map(Number);
    const date  = new Date(parts[0], parts[1] - 1, parts[2]);
    const icon  = pending.frequency === 'One-time visit' ? '✂️' : '📅';

    CalendarApp.getDefaultCalendar().createAllDayEvent(
      icon + ' ' + pending.service + ' – ' + pending.name,
      date,
      {
        description: [
          'Service:   ' + pending.service,
          'Price:     ' + pending.price + ' (charge after job via charge.html)',
          'Frequency: ' + pending.frequency,
          '',
          'Customer:  ' + pending.name,
          'Phone:     ' + pending.phone,
          'Email:     ' + pending.email,
          'Address:   ' + pending.address,
          '',
          'Notes: ' + pending.notes,
          '',
          '💳 Card on file — use charge.html to collect payment after mowing.',
        ].join('\n'),
        location: pending.address,
      }
    );
  } catch (err) {
    Logger.log('Calendar error: ' + err.message);
  }
}


// ═══════════════════════════════════════════════════════════════════
// STRIPE HELPERS
// ═══════════════════════════════════════════════════════════════════

function stripeRequest(method, endpoint, params) {
  const url = 'https://api.stripe.com/v1/' + endpoint;

  const options = {
    method:             method.toLowerCase(),
    headers:            { Authorization: 'Bearer ' + STRIPE_SECRET_KEY },
    muteHttpExceptions: true,
  };

  if (method === 'POST') {
    // Build URL-encoded body from flat params object
    options.contentType = 'application/x-www-form-urlencoded';
    options.payload     = Object.entries(params)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
  }

  const res    = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(res.getContentText());

  if (result.error) throw new Error(result.error.message);
  return result;
}


// ═══════════════════════════════════════════════════════════════════
// RESPONSE HELPER
// ═══════════════════════════════════════════════════════════════════

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
