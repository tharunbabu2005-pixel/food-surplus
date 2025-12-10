// server/routes/orders.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const auth = require('../utils/authMiddleware');

// POST /api/orders - place order (student)
router.post('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No token' });

    const db = req.app.locals.db;
    const userId = req.user.userId;
    const { listingId, quantity = 1 } = req.body;

    if (!ObjectId.isValid(listingId)) return res.status(400).json({ error: 'Invalid listing id' });
    const listing = await db.collection('listings').findOne({ _id: new ObjectId(listingId) });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Atomically decrement quantity using findOneAndUpdate
    const updated = await db.collection('listings').findOneAndUpdate(
      { _id: listing._id, quantityAvailable: { $gte: quantity } },
      { $inc: { quantityAvailable: -quantity } },
      { returnDocument: 'after' }
    );

    if (!updated.value) {
      return res.status(400).json({ error: 'Insufficient quantity' });
    }

    const order = {
      studentId: new ObjectId(userId),
      restaurantId: listing.restaurantId || null,
      listingId: listing._id,
      quantity,
      totalAmount: (listing.price || 0) * quantity,
      paymentStatus: 'pending',
      status: 'placed',
      createdAt: new Date()
    };

    const result = await db.collection('orders').insertOne(order);
    res.status(201).json({ orderId: result.insertedId, listingAfter: updated.value });
  } catch (err) {
    console.error('place order error:', err);
    res.status(500).json({ error: 'Order failed' });
  }
});

// GET /api/orders/user - orders for logged-in user
router.get('/user', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No token' });

    const db = req.app.locals.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let filter;
    if (user.role === 'restaurant') {
      filter = { restaurantId: user._id };
    } else {
      filter = { studentId: user._id };
    }

    const orders = await db.collection('orders').find(filter).sort({ createdAt: -1 }).toArray();
    res.json(orders);
  } catch (err) {
    console.error('get orders error:', err);
    res.status(500).json({ error: 'Fetch orders failed' });
  }
});

// PUT /api/orders/:id/status - update order status (restaurant)
router.put('/:id/status', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No token' });
    if (req.user.role !== 'restaurant') return res.status(403).json({ error: 'Only restaurants can update status' });

    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid order id' });

    const db = req.app.locals.db;
    // Optionally ensure restaurant owns the order
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.restaurantId || order.restaurantId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not your order' });
    }

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status required' });

    const result = await db.collection('orders').updateOne({ _id: order._id }, { $set: { status } });
    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('update order status error:', err);
    res.status(500).json({ error: 'Status update failed' });
  }
});

module.exports = router;
