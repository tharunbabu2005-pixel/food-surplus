// server/routes/web.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

// ---------- helper middleware ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireRestaurant(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'restaurant') return next();
  res.status(403).send('Forbidden: restaurant only');
}

// ---------- Home (listings) ----------
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const q = req.query.q || '';
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.max(1, Math.min(24, parseInt(req.query.limit || '12', 10)));
  const skip = (page - 1) * limit;

  const filter = {};
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } }
    ];
  }

  const total = await db.collection('listings').countDocuments(filter);
  const items = await db.collection('listings').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();

  res.render('index', {
    user: req.session.user || null,
    listings: items,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
    q
  });
});

// ---------- Register (GET form + POST) ----------
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.render('register', { error: 'Missing fields' });

    const exists = await db.collection('users').findOne({ email });
    if (exists) return res.render('register', { error: 'Email already used' });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({ name, email, passwordHash, role: role || 'student', createdAt: new Date() });

    // set session
    req.session.user = { userId: result.insertedId.toString(), name, email, role: role || 'student' };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Server error' });
  }
});

// ---------- Login ----------
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { email, password } = req.body;
    const user = await db.collection('users').findOne({ email });
    if (!user) return res.render('login', { error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.render('login', { error: 'Invalid credentials' });

    req.session.user = { userId: user._id.toString(), name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Server error' });
  }
});

// ---------- Logout ----------
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/');
  });
});

// ---------- Create listing (form + handler) ----------
router.get('/create-listing', requireRestaurant, (req, res) => {
  res.render('create-listing', { user: req.session.user, error: null });
});

router.post('/create-listing', requireRestaurant, upload.single('image'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    let imageUrl = '';
    if (req.file) {
      // upload to cloudinary
      const buffer = req.file.buffer;
      const uploadStream = () =>
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'surplus_food' }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          streamifier.createReadStream(buffer).pipe(stream);
        });
      const result = await uploadStream();
      imageUrl = result.secure_url;
    }

    const payload = {
      restaurantId: new ObjectId(req.session.user.userId),
      title: req.body.title || '',
      description: req.body.description || '',
      price: Number(req.body.price) || 0,
      quantityAvailable: Number(req.body.quantityAvailable) || 0,
      imageUrl,
      createdAt: new Date()
    };

    if (!payload.title) return res.render('create-listing', { user: req.session.user, error: 'Title required' });

    await db.collection('listings').insertOne(payload);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('create-listing', { user: req.session.user, error: 'Failed to create listing' });
  }
});

// ---------- Listing detail + order (GET detail, POST order) ----------
router.get('/listing/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send('Invalid id');
    const listing = await db.collection('listings').findOne({ _id: new ObjectId(id) });
    if (!listing) return res.status(404).send('Not found');
    res.render('listing', { listing, user: req.session.user, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// place order (student only)
router.post('/listing/:id/order', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const db = req.app.locals.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.user.userId) });
    if (!user || user.role !== 'student') return res.status(403).send('Only students can order');

    const id = req.params.id;
    const qty = Math.max(1, parseInt(req.body.quantity || '1', 10));
    if (!ObjectId.isValid(id)) return res.status(400).send('Invalid id');

    // atomic decrement like earlier
    const updated = await db.collection('listings').findOneAndUpdate(
      { _id: new ObjectId(id), quantityAvailable: { $gte: qty } },
      { $inc: { quantityAvailable: -qty } },
      { returnDocument: 'after' }
    );
    if (!updated.value) return res.render('listing', { listing: await db.collection('listings').findOne({ _id: new ObjectId(id) }), user: req.session.user, error: 'Insufficient quantity' });

    const order = {
      studentId: new ObjectId(req.session.user.userId),
      restaurantId: updated.value.restaurantId || null,
      listingId: updated.value._id,
      quantity: qty,
      totalAmount: (updated.value.price || 0) * qty,
      paymentStatus: 'pending',
      status: 'placed',
      createdAt: new Date()
    };
    await db.collection('orders').insertOne(order);
    res.redirect('/orders');
  } catch (err) {
    console.error(err);
    res.status(500).send('Order failed');
  }
});

// ---------- My orders (student) ----------
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.user.userId) });
    if (!user) return res.redirect('/login');

    let orders;
    if (user.role === 'restaurant') {
      orders = await db.collection('orders').find({ restaurantId: user._id }).sort({ createdAt: -1 }).toArray();
    } else {
      orders = await db.collection('orders').find({ studentId: user._id }).sort({ createdAt: -1 }).toArray();
    }
    res.render('orders', { user: req.session.user, orders });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch orders');
  }
});

module.exports = router;
