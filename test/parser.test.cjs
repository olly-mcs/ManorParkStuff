// Quick check that the date finder still reads typical school-letter lines.
const assert = require('assert');
require('../parser.js');
const { findDates } = globalThis.MPDParser || require('../parser.js');
const today = new Date(2026, 10, 16);
const got = findDates([
  'Harvest Festival assembly on Friday 21st November at 9am',
  'Half term: 15th - 19th February 2027',
  'INSET day Monday 5 January',
  'Christmas Fair',
  'Saturday 6th December 2026',
  'Year 3 trip to the zoo - 03/12/2026',
], today).map(e => `${e.date}|${e.endDate || ''}|${e.title}`);
assert.deepStrictEqual(got, [
  '2026-11-21||Harvest Festival assembly at 9am',
  '2026-12-03||Year 3 trip to the zoo',
  '2026-12-06||Christmas Fair',
  '2027-01-05||INSET day',
  '2027-02-15|2027-02-19|Half term',
]);
console.log('parser ok');

const { guessWho } = globalThis.MPDParser || require('../parser.js');
assert.deepStrictEqual(guessWho('Y3 Journey to the Stable'), { guessWho: 'theo' });
assert.deepStrictEqual(guessWho('Y1 and Y2 Nativity'), { guessWho: 'ruby' });
assert.deepStrictEqual(guessWho('Years 1-4 sports day'), { guessWho: 'both' });
assert.deepStrictEqual(guessWho('Y3 and Y4 Christmas Service'), { guessWho: 'theo' });
assert.deepStrictEqual(guessWho('2pm Reception Christmas craft'), { otherGroup: 'Reception' });
assert.deepStrictEqual(guessWho('Pantomime'), {});
assert.deepStrictEqual(guessWho('Sycamore Class trip to Wagamama'), { guessWho: 'theo' });
assert.deepStrictEqual(guessWho('Hazel class assembly'), { guessWho: 'ruby' });
assert.deepStrictEqual(guessWho('Willow Class trip to Wagamama'), { otherGroup: 'Willow class' });
assert.deepStrictEqual(guessWho('Hazel and Sycamore swimming'), { guessWho: 'both' });

// Pasted email: the lines under a date become its details.
const pasted = findDates([
  'Year 3 trip to Kingston Maurward on Thursday 3rd December',
  'Please bring a packed lunch and wellies.',
  'Coach leaves at 9am.',
  '',
  'Unrelated paragraph.',
], today);
assert.strictEqual(pasted[0].guessWho, 'theo');
assert.strictEqual(pasted[0].details, 'Please bring a packed lunch and wellies. Coach leaves at 9am.');
console.log('who + details ok');

// PDFs: only the date list, never the letter text beside it or dates buried in sentences.
const pdf = findDates([
  ['Another wonderful week has', '13th November Children In Need Day'],
  ['been had at Manor Park! The', 'wc 16th November Anti-bullying week'],
  ['much colder now, so please', '14th December Y1 and Y2 Nativity 10:30am - 11:30am'],
  ['warm coat to school every day.'],
  ['SALT Drop-in sessions 28 January'],
  ['Future drop-in dates:'],
  ['6 May 2027'],
], today, { list: true }).map(e => `${e.date}|${e.title}|${e.details}`);
assert.deepStrictEqual(pdf, [
  '2026-11-13|Children In Need Day|',
  '2026-11-16|Anti-bullying week|',
  '2026-12-14|Y1 and Y2 Nativity 10:30am - 11:30am|',
]);
console.log('pdf list mode ok');

// School dinner PDFs: every date counts, including "16/11" and week ranges.
const { findMealDates } = globalThis.MPDParser || require('../parser.js');
assert.deepStrictEqual(findMealDates([
  'Theo Clark - Hot Meal Bookings',
  'Mon 16/11  Roast chicken',
  ['Wednesday 18th November', 'Pasta bake'],
  'Week of 23rd - 25th November: school dinner',
  'Lunch is served at 12.15',
], today), ['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-24', '2026-11-25']);
console.log('meal dates ok');

// Meal order screenshots read by OCR: mangled dates, two rows per day.
const { readMealOrder } = globalThis.MPDParser || require('../parser.js');
const order = readMealOrder(`Order #1
Date Diner Site Meal
09/11/2026 Ruby Example Manor Flapjack (GLUTEN)
- x Park Regular - Dessert
09/11/2026 Ruby Example Manor British Beef Bolognese with Colourful Pasta (GLUTEN) & Carrots.
- x Park Regular - Main Course
1111/2026 Ruby Example Manor Remembrance Shortbread (GLUTEN)
Regular - Dessert
11/11/1202 Ruby Example Manor Roast Pork with Gravy
Regular - Main Course
0711212026 Ruby Example Manor Jammy Shortbread
Regular - Dessert
07/12/2026 Ruby Example Manor Moroccan Chicken
Regular - Main Course
26/06/2026 Ruby Example Manor Banana Cake
Regular - Dessert
20/06/2026 Ruby Example Manor Cheese Roll
Regular - Main Course`.split('\n'), today);
assert.strictEqual(order.child, 'ruby');
assert.deepStrictEqual(order.dates, ['2026-06-26', '2026-11-09', '2026-11-11', '2026-12-07']);
assert.deepStrictEqual(order.menus['2026-11-09'], { dessert: 'Flapjack', main: 'British Beef Bolognese with Colourful Pasta & Carrots' });
console.log('meal order ok');
