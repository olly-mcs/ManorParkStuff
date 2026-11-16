/* Manor Park Dates: finds dates in text pulled from school letters.
   Works in the browser (window.MPDParser) and in Node (module.exports) for testing. */
(function (root) {
  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
    dec: 11, december: 11,
  };
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DAY_RE = '(\\d{1,2})(?:st|nd|rd|th)?';
  const WEEKDAY_RE = '(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?';
  const YEAR_RE = '(?:,?\\s*(\\d{4}))?';
  const DASH = '\\s*(?:-|–|—|to|until|till)\\s*';

  // Order matters: ranges first so their parts are not matched twice.
  const PATTERNS = [
    // 20th - 24th October 2026
    { re: new RegExp(`\\b${DAY_RE}${DASH}(?:${WEEKDAY_RE}\\s+)?${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?${YEAR_RE}`, 'gi'),
      build: m => ({ d1: +m[1], m1: m[3], d2: +m[2], m2: m[3], y: m[4] }) },
    // 30th October - 3rd November
    { re: new RegExp(`\\b${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?${YEAR_RE}${DASH}(?:${WEEKDAY_RE}\\s+)?${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?${YEAR_RE}`, 'gi'),
      build: m => ({ d1: +m[1], m1: m[2], y1: m[3], d2: +m[4], m2: m[5], y: m[6] || m[3] }) },
    // 3rd November 2026 / 3 Nov
    { re: new RegExp(`\\b${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?${YEAR_RE}`, 'gi'),
      build: m => ({ d1: +m[1], m1: m[2], y: m[3] }) },
    // November 3rd, 2026
    { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+${DAY_RE}\\b${YEAR_RE}`, 'gi'),
      build: m => ({ d1: +m[2], m1: m[1], y: m[3] }) },
    // 03/11/2026, 3.11.26 (UK order: day first)
    { re: /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/g,
      build: m => ({ d1: +m[1], m1: +m[2] - 1, y: m[3].length === 2 ? '20' + m[3] : m[3], numeric: true }) },
  ];

  function iso(y, m, d) {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // With no year in the letter, pick the one that puts the date nearest "now":
  // anything more than two months in the past is taken to mean next year.
  function guessYear(month, day, today) {
    let y = today.getFullYear();
    const candidate = new Date(y, month, day);
    const cutoff = new Date(today.getFullYear(), today.getMonth() - 2, today.getDate());
    if (candidate < cutoff) y += 1;
    return y;
  }

  function monthIndex(v) {
    if (typeof v === 'number') return v;
    return MONTHS[String(v).toLowerCase().replace(/\.$/, '')];
  }

  function cleanTitle(text) {
    return String(text)
      .replace(new RegExp(`\\b${WEEKDAY_RE}\\b,?`, 'gi'), ' ')
      .replace(/^\s*(?:w\/c|w\.c\.|wc|week commencing|week beginning)\b\.?/i, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s•·▪●*\-–—:,;|]+|[\s•·▪●*\-–—:,;|]+$/g, '')
      .replace(/^(on|from|by|the|of)\s+/i, '')
      .replace(/\s+(on|from|by|the|of|is|will be)$/i, '')
      .trim()
      .replace(/^./, c => c.toUpperCase());
  }

  function hasDate(t) {
    return PATTERNS.some(p => { p.re.lastIndex = 0; const r = p.re.test(t); p.re.lastIndex = 0; return r; });
  }

  /* Theo is in Year 3 and Ruby in Year 1. Reads year groups mentioned in the text
     ("Y3", "Year 1 and 2", "Years 3 & 4") and says who it's for. */
  const CHILD_YEARS = { theo: 3, ruby: 1 };
  // Theo is in Sycamore class, Ruby in Hazel class.
  const CHILD_CLASSES = { theo: ['Sycamore'], ruby: ['Hazel'] };
  function guessWho(text) {
    const inClass = name => CHILD_CLASSES[name].some(c => new RegExp(`\\b${c}\\b`, 'i').test(text));
    const years = new Set();
    const re = /\b(?:y|yr|yrs|year|years)\s?(\d)((?:\s*(?:,|&|and|\/|-|–|to)\s*(?:y|yr|year)?\s?\d)*)/gi;
    let m;
    while ((m = re.exec(text))) {
      const nums = [m[1], ...(m[2].match(/\d/g) || [])].map(Number);
      // "Years 1-4" means every year in between.
      if (/(?:-|–|to)/.test(m[2]) && nums.length === 2) for (let n = nums[0]; n <= nums[1]; n++) years.add(n);
      else nums.forEach(n => years.add(n));
    }
    const early = /\b(reception|pre-?school|nursery|roots and shoots)\b/i.test(text);
    const theo = years.has(CHILD_YEARS.theo) || inClass('theo');
    const ruby = years.has(CHILD_YEARS.ruby) || inClass('ruby');
    if (theo && ruby) return { guessWho: 'both' };
    if (theo) return { guessWho: 'theo' };
    if (ruby) return { guessWho: 'ruby' };
    // Another class named ("Willow Class trip") with no year group mentioned.
    const ours = [...CHILD_CLASSES.theo, ...CHILD_CLASSES.ruby].map(c => c.toLowerCase());
    const otherClasses = [...text.matchAll(/\b([A-Z][a-z]+) [Cc]lass\b/g)]
      .map(m => m[1]).filter(c => !ours.includes(c.toLowerCase()));
    if (years.size || early || otherClasses.length) {
      const names = [...years].sort().map(n => 'Year ' + n);
      otherClasses.forEach(c => names.push(c + ' class'));
      if (early) names.unshift(/pre-?school|nursery/i.test(text) ? 'Preschool' : 'Reception');
      return { otherGroup: names.join(', ') };
    }
    return {};
  }

  /**
   * Groups pdf.js text items into rows, and splits each row into segments where there is a
   * wide horizontal gap, so side-by-side columns don't run together.
   * items: [{ str, x, y, w, h }]  (PDF units, y grows upwards)
   */
  function groupItems(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      let row = rows.find(r => Math.abs(r.y - it.y) < Math.max(2, (it.h || 10) * 0.35));
      if (!row) rows.push(row = { y: it.y, items: [] });
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
      const its = r.items.sort((a, b) => a.x - b.x);
      const segs = [];
      let cur = null, end = -Infinity;
      for (const it of its) {
        const gap = it.x - end;
        const h = it.h || 10;
        if (!cur || gap > Math.max(14, h * 1.4)) segs.push(cur = []);
        cur.push(it.str);
        end = it.x + (it.w || it.str.length * h * 0.5);
      }
      return segs.map(sg => sg.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    }).filter(r => r.length);
  }

  /**
   * lines: array of strings (one per line of the PDF, in reading order).
   * Returns [{ date, endDate?, title, context }]
   */
  /**
   * options.list = true (PDFs): only take entries laid out as a list, i.e. a line that starts
   * with a date and has its name on the same line. Body text and stray dates are ignored,
   * and no notes are taken from the lines around it.
   */
  function findDates(lines, today = new Date(), options = {}) {
    const list = !!options.list;
    const startsWithDate = new RegExp(`^(?:(?:w\\/c|w\\.c\\.|wc|week commencing|week beginning)\\s+)?(?:${WEEKDAY_RE},?\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i');
    const found = [];
    const seen = new Set();
    // Each line may be a string or an array of side-by-side segments.
    // Blank lines are kept as empty rows: they mark the end of a paragraph.
    const rows = lines
      .map(l => (Array.isArray(l) ? l : [l]).map(t => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean));

    rows.forEach((row, i) => row.forEach((seg, j) => {
      let rest = seg;
      const hits = [];
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(rest))) {
          hits.push({ parts: p.build(m), text: m[0] });
          // Blank out the match so smaller patterns don't find it again.
          rest = rest.slice(0, m.index) + '\u0000'.repeat(m[0].length) + rest.slice(m.index + m[0].length);
          p.re.lastIndex = m.index + m[0].length;
        }
      }
      if (!hits.length) return;
      if (list && !startsWithDate.test(seg)) return;

      // Title: the segment minus its dates, then the segment to its right,
      // then a neighbouring line with no date of its own (e.g. a heading above).
      const stripped = rest
        .replace(new RegExp(`\\b(?:on|by|from|until|before|after|the|of)\\s*(?:${WEEKDAY_RE},?\\s*)?(\u0000+)`, 'gi'), '$1')
        .replace(/\u0000+/g, ' ');
      let title = cleanTitle(stripped);
      let context = seg;
      if (title.length < 3 && row[j + 1] && !hasDate(row[j + 1])) {
        title = cleanTitle(row[j + 1]);
        context = seg + '  ' + row[j + 1];
      }
      if (title.length < 3 && row.length === 1 && !list) {
        const prev = rows[i - 1], next = rows[i + 1];
        const wordy = t => (t.match(/[a-z]/gi) || []).length >= 3 && !/^(www\.|https?:)/i.test(t);
        const pick = [prev, next].find(r => r && r.length === 1 && !hasDate(r[0]) && wordy(cleanTitle(r[0])));
        if (pick) title = cleanTitle(pick[0]);
      }
      if (title.length > 120) title = title.slice(0, 117).trim() + '…';

      // Details: the lines that follow in the same paragraph, until the next date.
      const more = [];
      if (row.length === 1 && !list) {
        for (let k = i + 1; k < rows.length && more.length < 4; k++) {
          const r = rows[k];
          if (!r.length || r.length > 1 || hasDate(r[0])) break;
          if (cleanTitle(r[0]) === title) continue;
          more.push(r[0]);
        }
      }
      const details = more.join(' ').slice(0, 400);
      const who = guessWho(context + ' ' + details);

      if (list && title.length < 3) return; // a date with no name next to it

      for (const h of hits) {
        const { d1, d2, y } = h.parts;
        const m1 = monthIndex(h.parts.m1);
        const m2 = h.parts.m2 != null ? monthIndex(h.parts.m2) : null;
        if (m1 == null || m1 < 0 || m1 > 11) continue;
        const year = y ? +y : guessYear(m1, d1, today);
        const date = iso(year, m1, d1);
        if (!date) continue;
        let endDate = null;
        if (d2 != null && m2 != null) {
          const y2 = year + (m2 < m1 ? 1 : 0);
          endDate = iso(y2, m2, d2);
          if (endDate && endDate <= date) endDate = null;
        }
        const key = date + '|' + title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ date, endDate, title: title || 'School date', context, details, ...who });
      }
    }));

    return found.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * School dinner PDFs: every date mentioned anywhere is a dinner day.
   * Also reads "16/11" with no year, and a range ("16th - 20th November") as every weekday in it.
   * Returns sorted ISO dates.
   */
  function findMealDates(lines, today = new Date()) {
    const out = new Set();
    const text = lines.map(l => (Array.isArray(l) ? l.join('   ') : String(l))).join('\n');
    let rest = text;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(rest))) {
        const { d1, d2, y } = p.build(m);
        const m1 = monthIndex(p.build(m).m1);
        const m2v = p.build(m).m2;
        const m2 = m2v != null ? monthIndex(m2v) : null;
        if (m1 != null && m1 >= 0 && m1 <= 11) {
          const year = y ? +y : guessYear(m1, d1, today);
          const start = iso(year, m1, d1);
          if (start) {
            out.add(start);
            if (d2 != null && m2 != null) {
              const end = iso(year + (m2 < m1 ? 1 : 0), m2, d2);
              const d = new Date(year, m1, d1);
              for (let n = 0; end && n < 31; n++) {
                d.setDate(d.getDate() + 1);
                const k = iso(d.getFullYear(), d.getMonth(), d.getDate());
                if (k > end) break;
                if (d.getDay() !== 0 && d.getDay() !== 6) out.add(k);
              }
            }
          }
        }
        rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
        p.re.lastIndex = m.index + m[0].length;
      }
    }
    // Day/month with no year, e.g. "Mon 16/11". Skips times like 10.30.
    const short = /(?<![\d:.\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/g;
    let m;
    while ((m = short.exec(rest))) {
      const d = +m[1], mo = +m[2] - 1;
      if (mo < 0 || mo > 11) continue;
      const k = iso(guessYear(mo, d, today), mo, d);
      if (k) out.add(k);
    }
    return [...out].sort();
  }

  const api = { findDates, groupItems, guessWho, findMealDates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPDParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
