// server/routes/listings.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const auth = require('../utils/authMiddleware');

// Create listing (restaurant only) - keep existing
router.post('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No token' });
    if (req.user.role !== 'restaurant') return res.status(403).json({ error: 'Only restaurants can create listings' });

    const db = req.app.locals.db;
    const payload = {
      restaurantId: new ObjectId(req.user.userId),
      title: req.body.title || '',
      description: req.body.description || '',
      price: Number(req.body.price) || 0,
      quantityAvailable: Number(req.body.quantityAvailable) || 0,
      imageUrl: req.body.imageUrl || '',
      createdAt: new Date()
    };

    if (!payload.title) return res.status(400).json({ error: 'Title is required' });

    const result = await db.collection('listings').insertOne(payload);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error('create listing error:', err);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

// GET /api/listings
// supports ?q=searchText&page=1&limit=10
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const q = req.query.q || ''; // search text
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '12', 10)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (q) {
      // text search on title and description
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    const total = await db.collection('listings').countDocuments(filter);
    const items = await db.collection('listings')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      data: items
    });
  } catch (err) {
    console.error('fetch listings error:', err);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const db = req.app.locals.db;
    const doc = await db.collection('listings').findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    console.error('get listing error:', err);
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
});

// GET /api/listings/mine - restaurant's own listings
router.get('/mine', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No token' });
    if (req.user.role !== 'restaurant') return res.status(403).json({ error: 'Only restaurants' });
    const db = req.app.locals.db;
    const items = await db.collection('listings')
      .find({ restaurantId: new ObjectId(req.user.userId) })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  } catch (err) {
    console.error('get mine error:', err);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

module.exports = router;
