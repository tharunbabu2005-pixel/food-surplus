// server/seed.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function seed() {
  try {
    await client.connect();
    const db = client.db();

    await db.collection('users').deleteMany({});
    await db.collection('listings').deleteMany({});

    const resto = await db.collection('users').insertOne({
      name: 'Demo Restaurant',
      email: 'resto@demo.com',
      passwordHash: 'demo-hash', // real app: use bcrypt
      role: 'restaurant',
      createdAt: new Date()
    });

    await db.collection('listings').insertMany([
      { restaurantId: resto.insertedId, title: 'Veg Meal Box', description: 'Rice & veg', price: 30, quantityAvailable: 5, createdAt: new Date() },
      { restaurantId: resto.insertedId, title: 'Bread Pack', description: 'Sandwiches', price: 20, quantityAvailable: 8, createdAt: new Date() }
    ]);

    console.log('Seed complete');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
seed();
