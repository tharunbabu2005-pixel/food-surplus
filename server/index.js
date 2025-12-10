// server/index.js - full working version with session-store compatibility
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const connectMongo = require('connect-mongo');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/surplusdb';

// Create a single MongoClient instance
const client = new MongoClient(MONGODB_URI);

async function start() {
  try {
    await client.connect();
    const db = client.db();
    app.locals.db = db;
    console.log('MongoDB connected (native driver)');

    // session setup (compatibility wrapper for connect-mongo)
        // session setup (robust compatibility wrapper for connect-mongo)
    let mongoStoreInstance;
    try {
      const maybe = connectMongo;

      const hasCreate = maybe && typeof maybe.create === 'function';
      const isFunctionExport = typeof maybe === 'function';
      const hasDefault = maybe && typeof maybe.default === 'object';

      if (hasCreate) {
        // modern API
        mongoStoreInstance = maybe.create({
          client: client,
          ttl: 14 * 24 * 60 * 60
        });
        console.log('Using connect-mongo.create() store');
      } else if (isFunctionExport) {
        // legacy: require('connect-mongo')(session)
        const LegacyMongoStore = maybe(session);
        mongoStoreInstance = new LegacyMongoStore({
          client,
          ttl: 14 * 24 * 60 * 60
        });
        console.log('Using legacy connect-mongo (function export) store');
      } else if (hasDefault && typeof maybe.default.create === 'function') {
        mongoStoreInstance = maybe.default.create({
          client,
          ttl: 14 * 24 * 60 * 60
        });
        console.log('Using connect-mongo.default.create() store');
      } else if (hasDefault && typeof maybe.default === 'function') {
        const LegacyMongoStore = maybe.default(session);
        mongoStoreInstance = new LegacyMongoStore({
          client,
          ttl: 14 * 24 * 60 * 60
        });
        console.log('Using legacy connect-mongo via default export');
      } else {
        throw new Error('Unsupported connect-mongo export shape');
      }
    } catch (err) {
      console.error('Failed to create session store (connect-mongo)', err);
      mongoStoreInstance = null;
    }

    app.use(session({
      secret: process.env.SESSION_SECRET || 'change_this_secret',
      resave: false,
      saveUninitialized: false,
      store: mongoStoreInstance || undefined,
      cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 } // 14 days
    }));


    // mount API routes (keep these files present)
    // If any of these require() fail, server will crash and you will see the error.
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/listings', require('./routes/listings'));
    app.use('/api/orders', require('./routes/orders'));
    app.use('/api/upload', require('./routes/upload'));

    // mount web routes
    app.use('/', require('./routes/web'));

    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

start();
