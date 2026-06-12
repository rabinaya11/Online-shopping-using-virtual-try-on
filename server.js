const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== CONFIGURATION ====================
const GEMINI_API_KEY = 'AIzaSyDbqSRTqat3sM7IuMdqW2kfh_1HrDfyFUg';

// Razorpay (Test Mode)
const razorpay = new Razorpay({
    key_id: 'rzp_test_SWw1NcnGLIOEkK',
    key_secret: 'EyIS9bHEyOOKh7u04uzPfx88'
});

// ==================== TRY-ON API (YOUR EXISTING CODE) ====================
const fetchWithRetry = async (url, options, retries = 4, delay = 3000) => {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Attempt ${i + 1}/${retries} calling Google API...`);
            const response = await fetch(url, options);
            
            if (response.ok) {
                console.log(`Request succeeded on attempt ${i + 1}`);
                return response;
            }
            
            if (response.status === 503 && i < retries - 1) {
                console.log(`⚠️ 503 error (high demand). Retrying in ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            return response;
            
        } catch (error) {
            if (i < retries - 1) {
                console.log(`⚠️ Network error: ${error.message}. Retrying in ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries exceeded');
};

app.post('/api/tryon', async (req, res) => {
    try {
        const { personImage, dressImage } = req.body;
        if (!personImage || !dressImage) {
            return res.status(400).json({ error: 'Both images required' });
        }

        console.log('📸 Received try-on request');
        console.log(`Person image length: ${personImage?.length || 0}`);
        console.log(`Dress image length: ${dressImage?.length || 0}`);

        const model = "gemini-3.1-flash-image-preview";

        const requestBody = {
            contents: [{
                parts: [
                    { text: "Create a photorealistic image of the person from the first image wearing the clothing from the second image. Preserve the person's face and body exactly." },
                    { inlineData: { mimeType: "image/jpeg", data: personImage } },
                    { inlineData: { mimeType: "image/jpeg", data: dressImage } }
                ]
            }],
            generationConfig: { responseModalities: ["IMAGE"] }
        };

        const response = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            },
            4, 4000
        );

        const data = await response.json();

        if (!response.ok) {
            console.error('API error response:', data);
            throw new Error(data.error?.message || `API error: ${response.status}`);
        }

        const parts = data.candidates?.[0]?.content?.parts;
        let imageData = null;
        if (parts) {
            for (const part of parts) {
                if (part.inlineData?.data) {
                    imageData = part.inlineData.data;
                    break;
                }
            }
        }

        if (!imageData) {
            throw new Error('No image data in response');
        }

        console.log('✅ Success! Returning image');
        res.json({ image: `data:image/jpeg;base64,${imageData}` });
        
    } catch (error) {
        console.error('❌ Generation error:', error);
        res.status(500).json({ error: 'Try-on generation failed: ' + error.message });
    }
});

// ==================== PAYMENT API (NEW) ====================

// Create Razorpay order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        console.log(`💰 Creating order for amount: ₹${amount}`);
        
        const options = {
            amount: amount * 100,          // amount in paise
            currency: 'INR',
            receipt: `receipt_${Date.now()}`
        };
        
        const order = await razorpay.orders.create(options);
        console.log(`✅ Order created: ${order.id}`);
        
        res.json({
            id: order.id,
            amount: order.amount,
            currency: order.currency
        });
    } catch (error) {
        console.error('❌ Order creation error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Verify payment signature
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { order_id, payment_id, signature } = req.body;
        console.log(`🔐 Verifying payment: order=${order_id}, payment=${payment_id}`);
        
        const body = order_id + '|' + payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', 'EyIS9bHEyOOKh7u04uzPfx88')
            .update(body)
            .digest('hex');
        
        if (expectedSignature === signature) {
            console.log('✅ Payment verified successfully');
            res.json({ success: true });
        } else {
            console.log('❌ Invalid signature');
            res.status(400).json({ error: 'Invalid signature' });
        }
    } catch (error) {
        console.error('❌ Verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Test endpoint (check if backend is running)
app.get('/api/test', (req, res) => {
    res.json({ message: 'Backend is running!', status: 'ok' });
});

// ==================== START SERVER ====================
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
    console.log(`   - Try-on API: POST /api/tryon`);
    console.log(`   - Create order: POST /api/create-order`);
    console.log(`   - Verify payment: POST /api/verify-payment`);
});