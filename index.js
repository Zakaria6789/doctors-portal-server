const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
    });
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hiruw.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("bookings");
        const userCollection = client.db("doctors_portal").collection("users");
        const doctorCollection = client.db("doctors_portal").collection("doctor");
        const paymentCollection = client.db("doctors_portal").collection("payment");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Request Forbidden' })
            }
        }


        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });

            res.send({ clientSecret: paymentIntent.client_secret });


        });

        app.patch('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                },
            };

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updateDoc);
        })

        app.get('/services', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        });


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });

        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        });

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);

            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        });


        app.get('/available', async (req, res) => {

            // step-1: get all services
            const services = await serviceCollection.find().toArray();

            // step-2: get booked appointment of that day
            const date = req.query.slotDate;
            const query = { slotDate: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step-3: for each services
            services.forEach(service => {
                // step-4: find booking for that service
                const serviceBooking = bookings.filter(book => book.treatmentName === service.name);

                // step-5: select slotTime for the service booking
                const bookedSlots = serviceBooking.map(book => book.slotTime);

                // step-6: select those slot are not in bookedstots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                // step-7 set slots property again
                service.slots = available;
            })
            res.send(services);
        });


        app.get('/booking', verifyJWT, async (req, res) => {
            const patientEmail = req.query.patientEmail;
            const decodedEmail = req.decoded.email;
            if (patientEmail === decodedEmail) {
                const query = { patientEmail: patientEmail };
                const booking = await bookingCollection.find(query).toArray();
                return res.send(booking);
            }
            else {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
        });

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        app.get('/users', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, slotDate: booking.slotDate, patientName: booking.patientName };
            const exist = await bookingCollection.findOne(query);
            if (exist) {
                return res.send({ success: false, booking: exist });
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });

        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctorInfo = req.body;
            const result = await doctorCollection.insertOne(doctorInfo);
            res.send(result);
        });

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await doctorCollection.find().toArray();
            res.send(result);
        });

        app.delete('/doctors/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        });


    }
    finally {

    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('doctors portal is running !')
})

app.listen(port, () => {
    console.log(`Doctors Portal is listening on port ${port}`)
})