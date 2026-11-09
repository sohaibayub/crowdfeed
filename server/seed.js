// Starting data: the three LUMS venues used in the original study and a
// question bank per venue type, carried over from the 2016 bank and extended
// with follow-up rules and queue questions. Seeding only runs on an empty
// database, so edits made in the dashboard are never overwritten.

import { db, now } from './db.js';
import { hashPin } from './auth.js';

const STAFF = ['Excellent', 'Good', 'Fair', 'Poor'];
const WAIT = ['Under 5 minutes', '5 to 10 minutes', '10 to 20 minutes', 'Over 20 minutes'];

const common = (type) => [
  { key: 'wait_time', widget: 'radio', text: 'How long did you wait in the queue today?', options: WAIT, priority: 55 },
  { key: 'queue_feeling', widget: 'smileyslider', text: 'How did the wait feel?', priority: 45 },
  {
    key: 'wait_fix',
    widget: 'radio',
    text: 'What would have made the wait better?',
    options: ['More counters open', 'Faster service', 'Somewhere to sit', 'Something to do while waiting', 'Clearer queue'],
    priority: 60,
    conditions: { requires: [{ key: 'wait_time', op: 'in', value: ['10 to 20 minutes', 'Over 20 minutes'] }] }
  },
  { key: 'staff', widget: 'radio', text: 'How would you rate our staff?', options: STAFF, priority: 60 },
  { key: 'service_env', widget: 'slider', text: 'Rate our service and environment', priority: 70 },
  { key: 'recommend', widget: 'thumbs', text: `Would you suggest this ${type} to your friends?`, priority: 75, required: 1 },
  {
    key: 'recommend_why_not',
    widget: 'text',
    text: 'What would make you recommend us?',
    priority: 85,
    conditions: { requires: [{ key: 'recommend', op: '==', value: 'down' }] }
  },
  { key: 'suggestions', widget: 'text', text: 'Please give us your suggestions', priority: 40 }
];

const bank = {
  restaurant: [
    { key: 'best_for', widget: 'rank', text: 'This place is best for', options: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Party'], priority: 60 },
    { key: 'presentation', widget: 'smileys', text: 'What do you feel about the presentation of the food here?', priority: 70 },
    { key: 'taste', widget: 'stars', text: 'Rate the taste of the food', priority: 80, required: 1 },
    {
      key: 'taste_issue',
      widget: 'radio',
      text: 'What should we improve about the food?',
      options: ['Taste', 'Temperature', 'Portion size', 'Freshness', 'Variety'],
      priority: 90,
      conditions: { requires: [{ key: 'taste', op: '<=', value: 2 }] }
    },
    { key: 'company', widget: 'segmented', text: 'You usually come here with', options: ['Family', 'Friends', 'Colleagues', 'Alone'], priority: 50 },
    { key: 'prices', widget: 'smileyslider', text: 'How do you feel about our prices?', priority: 60 },
    ...common('restaurant')
  ],
  cafe: [
    { key: 'best_for', widget: 'rank', text: 'This place is best for', options: ['Coffee', 'Snacks', 'Studying', 'Meeting friends', 'Breakfast'], priority: 60 },
    { key: 'coffee', widget: 'stars', text: 'Rate the taste of our coffee and drinks', priority: 80, required: 1 },
    {
      key: 'coffee_issue',
      widget: 'radio',
      text: 'What should we improve about the drinks?',
      options: ['Taste', 'Temperature', 'Size', 'Choice of drinks', 'Price'],
      priority: 90,
      conditions: { requires: [{ key: 'coffee', op: '<=', value: 2 }] }
    },
    { key: 'presentation', widget: 'smileys', text: 'What do you feel about the presentation of the food and drinks?', priority: 65 },
    { key: 'seating', widget: 'thumbs', text: 'Could you find a comfortable place to sit?', priority: 55 },
    { key: 'prices', widget: 'smileyslider', text: 'How do you feel about our prices?', priority: 60 },
    ...common('cafe')
  ],
  grocery: [
    { key: 'shop_rank', widget: 'rank', text: 'Rank what you shop for here most', options: ['Groceries', 'Fresh produce', 'Household items', 'Snacks', 'Drinks'], priority: 60 },
    { key: 'quality', widget: 'smileys', text: 'How satisfied are you with the quality of the items here?', priority: 75, required: 1 },
    {
      key: 'quality_issue',
      widget: 'radio',
      text: 'What disappointed you about the quality?',
      options: ['Freshness', 'Expiry dates', 'Damaged packaging', 'Fake or low quality brands', 'Price for quality'],
      priority: 90,
      conditions: { requires: [{ key: 'quality', op: '<=', value: 2 }] }
    },
    { key: 'freshness', widget: 'stars', text: 'How fresh are the items you buy here?', priority: 65 },
    { key: 'brand', widget: 'segmented', text: 'Which company’s products do you buy most?', options: ['Unilever', 'Nestlé', 'P&G', 'Shan'], priority: 45 },
    { key: 'found_all', widget: 'thumbs', text: 'Did you find everything you needed today?', priority: 70 },
    {
      key: 'missing_items',
      widget: 'text',
      text: 'Which items could you not find?',
      priority: 90,
      conditions: { requires: [{ key: 'found_all', op: '==', value: 'down' }] }
    },
    { key: 'variety', widget: 'smileyslider', text: 'How do you find the variety of items here?', priority: 55 },
    ...common('store')
  ],
  clothing: [
    { key: 'shop_rank', widget: 'rank', text: 'Rank the products according to your shopping preferences', options: ['Clothes', 'Shoes', 'Accessories', 'Cosmetics', 'Household'], priority: 60 },
    { key: 'quality', widget: 'smileys', text: 'How satisfied are you with the quality of our products?', priority: 75, required: 1 },
    {
      key: 'quality_issue',
      widget: 'radio',
      text: 'What disappointed you about the quality?',
      options: ['Fabric', 'Stitching', 'Fit', 'Colour fading', 'Price for quality'],
      priority: 90,
      conditions: { requires: [{ key: 'quality', op: '<=', value: 2 }] }
    },
    { key: 'durability', widget: 'stars', text: 'How durable do you find the material of our products?', priority: 65 },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Amir Adnan', 'Stoneage', 'Junaid Jamshed', 'Nike'], priority: 45, conditions: { gender: ['man'] } },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Gul Ahmed', 'Junaid Jamshed', 'Generation', 'Khaadi'], priority: 45, conditions: { gender: ['woman'] } },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Junaid Jamshed', 'Khaadi', 'Gul Ahmed', 'Nike', 'Other'], priority: 45, conditions: { gender: ['non-binary', 'undisclosed'] } },
    { key: 'trends', widget: 'thumbs', text: 'Are our clothes according to the latest trends?', priority: 60 },
    { key: 'designs', widget: 'smileyslider', text: 'What do you feel about the designs of our clothes?', priority: 55 },
    ...common('store')
  ],
  shoes: [
    { key: 'shop_rank', widget: 'rank', text: 'Rank what you look for in a shoe', options: ['Comfort', 'Price', 'Durability', 'Style', 'Brand'], priority: 60 },
    { key: 'quality', widget: 'smileys', text: 'How satisfied are you with the quality of shoes here?', priority: 75, required: 1 },
    { key: 'durability', widget: 'stars', text: 'How durable do you find the shoes here?', priority: 65 },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Hush Puppies', 'Bata', 'Borjan', 'Servis'], priority: 45, conditions: { gender: ['man'] } },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Stylo', 'Metro Shoes', 'Starlet', 'Bata'], priority: 45, conditions: { gender: ['woman'] } },
    { key: 'brand', widget: 'segmented', text: 'Which brand do you like most?', options: ['Bata', 'Servis', 'Stylo', 'Hush Puppies', 'Other'], priority: 45, conditions: { gender: ['non-binary', 'undisclosed'] } },
    { key: 'comfort', widget: 'thumbs', text: 'Do you find our shoes comfortable?', priority: 70 },
    { key: 'designs', widget: 'smileyslider', text: 'What do you feel about the designs of our shoes?', priority: 55 },
    ...common('store')
  ],
  pharmacy: [
    { key: 'found_all', widget: 'thumbs', text: 'Did you get everything you came for?', priority: 75, required: 1 },
    {
      key: 'missing_items',
      widget: 'text',
      text: 'What could you not get today?',
      priority: 90,
      conditions: { requires: [{ key: 'found_all', op: '==', value: 'down' }] }
    },
    { key: 'advice', widget: 'stars', text: 'Rate the advice you received from our pharmacist', priority: 70 },
    { key: 'privacy', widget: 'smileys', text: 'How comfortable did you feel discussing your needs at the counter?', priority: 60 },
    { key: 'prices', widget: 'smileyslider', text: 'How do you feel about our prices?', priority: 55 },
    ...common('pharmacy')
  ],
  bank: [
    { key: 'purpose', widget: 'segmented', text: 'What brought you here today?', options: ['Cash', 'Bill payment', 'Account service', 'Loan or card', 'Other'], priority: 65 },
    { key: 'resolved', widget: 'thumbs', text: 'Was your matter resolved in one visit?', priority: 80, required: 1 },
    {
      key: 'not_resolved_why',
      widget: 'radio',
      text: 'What stopped it being resolved?',
      options: ['Missing documents', 'System down', 'Staff could not help', 'Sent to another branch', 'Other'],
      priority: 90,
      conditions: { requires: [{ key: 'resolved', op: '==', value: 'down' }] }
    },
    { key: 'clarity', widget: 'stars', text: 'How clearly was the process explained to you?', priority: 65 },
    { key: 'digital', widget: 'thumbs', text: 'Could this visit have been done in the app or online?', priority: 55 },
    ...common('branch')
  ],
  general: [
    { key: 'satisfaction', widget: 'smileys', text: 'How satisfied are you with your visit today?', priority: 80, required: 1 },
    {
      key: 'satisfaction_issue',
      widget: 'text',
      text: 'What went wrong today?',
      priority: 90,
      conditions: { requires: [{ key: 'satisfaction', op: '<=', value: 2 }] }
    },
    { key: 'value', widget: 'smileyslider', text: 'How do you feel about the value for money?', priority: 60 },
    { key: 'cleanliness', widget: 'stars', text: 'Rate the cleanliness of this place', priority: 60 },
    ...common('place')
  ]
};

const venues = [
  { slug: 'pdc', name: 'PDC', type: 'restaurant', lat: 31.471388, lng: 74.410348, reward: 'A free cup of tea', pin: '1234' },
  { slug: 'jammin-java', name: 'Jammin Java', type: 'cafe', lat: 31.468516, lng: 74.409791, reward: '20% off your next coffee', pin: '1234' },
  { slug: 'super-store', name: 'Super Store', type: 'grocery', lat: 31.471727, lng: 74.410063, reward: 'Rs. 50 off your bill', pin: '1234' }
];

export async function seedIfEmpty() {
  const existing = await db.get('SELECT COUNT(*) AS n FROM venues');
  if (existing && existing.n > 0) return false;
  const ts = now();
  const statements = [];
  for (const v of venues) {
    statements.push({
      sql: `INSERT INTO venues (slug, name, type, lat, lng, radius_m, reward, reward_terms, staff_pin_hash, active, created_at)
            VALUES (?, ?, ?, ?, ?, 75, ?, ?, ?, 1, ?)`,
      args: [v.slug, v.name, v.type, v.lat, v.lng, v.reward, 'Show the code at the counter. One reward per survey.', hashPin(v.pin), ts]
    });
  }
  for (const [type, questions] of Object.entries(bank)) {
    for (const q of questions) {
      statements.push({
        sql: `INSERT INTO questions (venue_id, venue_type, key, text, widget, options, conditions, priority, required, active, created_at)
              VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        args: [type, q.key, q.text, q.widget, JSON.stringify(q.options || []), JSON.stringify(q.conditions || {}), q.priority ?? 50, q.required ? 1 : 0, ts]
      });
    }
  }
  await db.batch(statements);
  return true;
}

export const questionBank = bank;
