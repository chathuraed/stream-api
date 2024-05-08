import express from 'express';
import dotenv from 'dotenv';
import { compareSync, genSaltSync, hashSync } from 'bcrypt';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { StreamClient } from '@stream-io/node-sdk';

dotenv.config();

const { PORT, STREAM_API_KEY, STREAM_API_SECRET, DB_STRING, JWT_SECRET } = process.env;

const client = new StreamClient(STREAM_API_KEY!, STREAM_API_SECRET!, { timeout: 3000 });

const app = express();
app.use(express.json());

mongoose.connect(DB_STRING!, {
    autoIndex: true
}).then((res) => {
    console.log('Database Connected');
}).catch((err) => {
    console.error('Error connecting to database:', err);
});

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    }
});

const User = mongoose.model('User', UserSchema);

// Middleware to verify JWT token
const verifyToken = (req: any, res: any, next: any) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(401).json({ message: 'Access token is required' });
    }

    jwt.verify(token, JWT_SECRET!, (err: any, decoded: any) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        req.userId = decoded.userId;
        next();
    });
};

app.get('/', (req, res) => {
    res.send("Hello World");
});


// app.get('/users', (req, res) => {
//     return res.json(users);
// });

app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if the user already exists
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash the password
        const hashedPassword = hashSync(password, 10);

        // Create a new user
        const newUser = new User({
            email,
            password: hashedPassword
        });

        await newUser.save();

        // Create a new user in StreamClient
        const userId = newUser._id.toString();
        const userObject = {
            id: userId,
            role: 'user',
            name: email, // You can use email or any other user information here
            // Add other user details like image if available
        };
        await client.upsertUsers({
            users: {
                [userId]: userObject,
            },
        });

        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find the user by email
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if the password is correct
        if (!compareSync(password, user.password!)) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Generate a token using StreamClient
        const userId = user._id.toString();
        const accessToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET!, { expiresIn: '1h' });
        const chatToken = client.createToken(userId);

        // Return the token along with user details
        res.json({ userId, email, accessToken, chatToken });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/profile', verifyToken, async (req: any, res: any) => {
    try {
        const user = await User.findById(req.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userId = user._id.toString();
        const accessToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET!, { expiresIn: '1h' });
        const chatToken = client.createToken(userId);

        // Return user profile
        res.json({ userId: user._id, email: user.email, accessToken, chatToken });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/get-token', async (req, res) => {
    try {
        // Retrieve userId from the request parameters
        const userId = req.query.userId!.toString();

        // Find the user by userId
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate a token for the user
        const token = client.createToken(userId);

        // Send the token in the response
        res.json({ token });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
