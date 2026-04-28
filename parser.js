function extractOrder(text) {
  const result = {};

  const orderPatterns = [
    /(?:bestelnummer|order\s*number|ordernummer|odernummer)[:\s#]*([A-Z0-9\-]{4,30})/i,
    /(?:order)[:\s#]+([A-Z0-9\-]{4,30})/i,
    /#\s*([A-Z0-9\-]{6,30})/
  ];
  for (const p of orderPatterns) {
    const m = text.match(p);
    if (m) { result.orderNumber = m[1].trim(); break; }
  }

  const shopPatterns = [
    /(?:bedankt voor je (?:aankoop|bestelling) (?:bij|van)|thanks for shopping at|welcome to|welkom bij)\s+([A-Z][A-Za-z0-9 &'.\-]{2,40})/i,
    /(?:info|orders|noreply|support|hello)@([a-z0-9\-]+)\.(?:nl|com|eu|de|be|co\.uk)/i,
    /@([a-z0-9\-]+)\.(?:nl|com|eu|de|be|co\.uk)/i
  ];
  for (const p of shopPatterns) {
    const m = text.match(p);
    if (m) {
      result.shop = m[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      break;
    }
  }

  const datePatterns = [
    /(?:order\s*placed|besteldatum|besteld op|placed on)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) { result.orderDate = normalizeDate(m[1]); break; }
  }

  const englishDelivery = text.match(
    /(?:by|op)\s+(?:thursday|friday|monday|tuesday|wednesday|saturday|sunday|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag),?\s*the\s*(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([A-Za-z]+)/i
  );
  if (englishDelivery) {
    result.deliveryDate = parseEnglishDate(englishDelivery[1], englishDelivery[2]);
  } else {
    const numericDelivery = text.match(
      /(?:estimated delivery|verwachte levering|bezorgdatum|delivery by)[^\d]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i
    );
    if (numericDelivery) result.deliveryDate = normalizeDate(numericDelivery[1]);
  }

  const trackingMatch = text.match(/(?:track(?:ing)?(?:\s*(?:nummer|number|code|id))?|t&t)[:\s#]*([A-Z0-9]{8,30})/i);
  if (trackingMatch) result.tracking = trackingMatch[1];

  const carrier = detectCarrier(text, result.tracking);
  if (carrier) result.carrier = carrier;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 8 && l.length < 120 && /[a-z]/i.test(l) &&
        !/^(dear|hi|hello|beste|hallo|bedankt|thanks|order|bestelling|subtotal|total|verzending|shipping|btw|address|bezorg|factuur|payment|betaling)/i.test(l) &&
        !/@/.test(l) && !/^\d/.test(l) && !/€|\$|£/.test(l.slice(0, 3))) {
      const next = lines.slice(i, i + 5).join(' ');
      if (/€|\$|£/.test(next)) {
        result.product = l.replace(/\s+\d{6,}.*$/, '').trim();
        break;
      }
    }
  }

  if (/verzonden|shipped|onderweg|dispatch/i.test(text) &&
      !/wij sturen|we'll send|we will send|will be shipped|wordt verzonden/i.test(text)) {
    result.status = 'verzonden';
  }
  if (/bezorgd|delivered/i.test(text)) result.status = 'bezorgd';

  return result;
}

function normalizeDate(s) {
  s = s.replace(/\./g, '/').replace(/-/g, '/');
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  d = d.padStart(2, '0');
  m = m.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseEnglishDate(day, month) {
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    januari: 1, februari: 2, maart: 3, mei: 5, juni: 6, juli: 7, augustus: 8, oktober: 10
  };
  const m = months[month.toLowerCase()];
  if (!m) return null;
  const y = new Date().getFullYear();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function detectCarrier(text, tracking) {
  const t = text.toLowerCase();
  if (/\bpostnl\b|post\.nl|jouw\.postnl/.test(t)) return 'postnl';
  if (/\bdhl\b|dhlparcel/.test(t)) return 'dhl';
  if (/\bdpd\b/.test(t)) return 'dpd';
  if (/\bups\b/.test(t)) return 'ups';
  if (/\bfedex\b/.test(t)) return 'fedex';
  if (/\bgls\b/.test(t)) return 'gls';
  if (/\bbpost\b/.test(t)) return 'bpost';
  if (tracking) {
    if (/^3S/.test(tracking)) return 'postnl';
    if (/^1Z/.test(tracking)) return 'ups';
    if (/^(JJD|JD)/.test(tracking)) return 'dhl';
  }
  return null;
}

module.exports = { extractOrder };
