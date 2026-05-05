import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Check, ShieldCheck, Zap, ChevronRight, XCircle,
  History, CreditCard, RefreshCcw
} from 'lucide-react';
import './index.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001/api/v1';

// ─── UTILS ───────────────────────────────────────────────────────────────────
const generateIdempotencyKey = () => `ik_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

const Navbar = () => {
  const location = useLocation();
  return (
    <nav className="nav">
      <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
        <CreditCard size={18} /> Buy Pro
      </Link>
      <Link to="/payments" className={`nav-link ${location.pathname === '/payments' ? 'active' : ''}`}>
        <History size={18} /> History
      </Link>
    </nav>
  );
};

// ─── PAGE: CHECKOUT ──────────────────────────────────────────────────────────
const CheckoutPage = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey());
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const [paymentDetails, setPaymentDetails] = useState(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    document.body.appendChild(script);
  }, []);

  const handlePayment = async () => {
    try {
      setLoading(true);
      setStatus('initiating');

      const initResponse = await fetch(`${API_BASE_URL}/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ amount: 50000, currency: 'INR' }),
      });

      const initData = await initResponse.json();
      if (!initResponse.ok) throw new Error(initData.error?.message || 'Initiation failed');

      const { order } = initData.data;
      setStatus('processing');

      const options = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'SaaS Platform Inc.',
        order_id: order.id,
        handler: async (response) => {
          try {
            setStatus('processing');
            const verifyRes = await fetch(`${API_BASE_URL}/payments/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `v_${idempotencyKey}` },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if (verifyRes.ok) {
              setPaymentDetails({
                id: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                amount: order.amount / 100
              });
              setStatus('success');
              setIdempotencyKey(generateIdempotencyKey());
            } else throw new Error(verifyData.error?.message || 'Verification failed');
          } catch (err) {
            setStatus('error');
            setErrorMsg(err.message);
          } finally {
            setLoading(false);
          }
        },
        modal: {
          ondismiss: async () => {
            setLoading(false);
            setStatus('error');
            setErrorMsg('Payment cancelled by user.');

            // Notify backend that payment failed/was cancelled
            try {
              await fetch(`${API_BASE_URL}/payments/fail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `f_${idempotencyKey}` },
                body: JSON.stringify({ razorpay_order_id: order.id }),
              });
            } catch (err) {
              console.error('Failed to notify backend of failure', err);
            }
          }
        },
      };

      if (order.keyId.includes('mock')) {
        setTimeout(() => options.handler({
          razorpay_order_id: order.id,
          razorpay_payment_id: `pay_mock_${Math.random().toString(36).substr(2, 8)}`,
          razorpay_signature: 'e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8'
        }), 1500);
        return;
      }

      const rzp = new window.Razorpay(options);

      // Handle payment failure event
      rzp.on('payment.failed', async (response) => {
        setLoading(false);
        setStatus('error');
        setErrorMsg(response.error.description);
        try {
          await fetch(`${API_BASE_URL}/payments/fail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `f_${idempotencyKey}` },
            body: JSON.stringify({
              razorpay_order_id: order.id,
              error_description: response.error.description
            }),
          });
        } catch (err) {
          console.error('Failed to notify backend of failure', err);
        }
      });

      rzp.open();
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <header className="header">
        <h1>Unlock Premium</h1>
      </header>
      <div className="glass-card">
        {status === 'idle' && (
          <>
            <div className="plan-badge">Pro Plan</div>
            <div className="price-container">
              <span className="currency">₹</span>
              <span className="price">500</span>
              <span className="text-muted">/month</span>
            </div>
            <ul className="features">
              <li className="feature-item"><Check className="feature-icon" size={20} /><span>Sample Card for payment</span></li>
            </ul>
            <button className="btn btn-primary" onClick={handlePayment} disabled={loading || !scriptLoaded}>
              {loading ? <div className="loader"></div> : <>Upgrade Now <ChevronRight size={20} /></>}
            </button>
          </>
        )}
        {(status === 'initiating' || status === 'processing') && (
          <div className="status-overlay">
            <div className="loader" style={{ width: '48px', height: '48px' }}></div>
            <h3 className="status-title" style={{ marginTop: '2rem' }}>
              {status === 'initiating' ? 'Securing Connection...' : 'Finalizing Payment...'}
            </h3>
            <p className="status-desc">Please do not close this window or press back.</p>
          </div>
        )}
        {status === 'success' && (
          <div className="status-overlay">
            <div className="status-icon success"><Check size={48} /></div>
            <h3 className="status-title">Payment Received!</h3>
            <p className="status-desc">Your Pro features have been unlocked instantly.</p>

            <div className="receipt-summary">
              <div className="receipt-row">
                <span className="receipt-label">Amount Paid</span>
                <span className="receipt-value">{formatCurrency(paymentDetails?.amount)}</span>
              </div>
              <div className="receipt-row">
                <span className="receipt-label">Payment ID</span>
                <span className="receipt-value" style={{ fontSize: '0.75rem' }}>{paymentDetails?.id}</span>
              </div>
            </div>

            <button className="btn btn-primary" onClick={() => setStatus('idle')}>
              Done
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="status-overlay">
            <div className="status-icon error"><XCircle size={48} /></div>
            <h3 className="status-title">Payment Failed</h3>
            <p className="status-desc">{errorMsg || 'An unexpected error occurred during processing.'}</p>

            <div className="receipt-summary" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.1)' }}>
              <p style={{ fontSize: '0.85rem', color: 'rgba(239, 68, 68, 0.8)', textAlign: 'center' }}>
                Don't worry, if your money was debited, it will be refunded within 5-7 business days.
              </p>
            </div>

            <button className="btn btn-primary" onClick={() => setStatus('idle')}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </>
  );
};

// ─── PAGE: PAYMENTS DASHBOARD ───────────────────────────────────────────────
const PaymentsPage = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payments`);
      const data = await res.json();
      setPayments(data.data.payments);
    } catch (err) {
      console.error('Failed to fetch payments', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/payments`);
        const data = await res.json();
        if (isMounted) {
          setPayments(data.data.payments);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to fetch payments', err);
          setLoading(false);
        }
      }
    };
    load();
    return () => { isMounted = false; };
  }, []);

  return (
    <>
      <header className="header">
        <h1>Payment History</h1>
        <p>Monitor all transactions and their current processing states.</p>
      </header>

      <div className="dashboard-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem' }}>Recent Transactions</h2>
          <button onClick={fetchPayments} className="btn-primary" style={{ padding: '0.5rem 1rem', width: 'auto', fontSize: '0.8rem', borderRadius: '8px' }}>
            <RefreshCcw size={14} style={{ marginRight: '0.5rem' }} /> Refresh
          </button>
        </div>

        <div className="table-container">
          {loading ? (
            <div className="empty-state">Loading transactions...</div>
          ) : payments.length === 0 ? (
            <div className="empty-state">No payments found.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Order ID</th>
                  <th>Payment ID</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(p.amount / 100)}</td>
                    <td>
                      <span className={`badge badge-${p.status.toLowerCase()}`}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ opacity: 0.7, fontSize: '0.85rem' }}>{p.razorpayOrderId}</td>
                    <td style={{ opacity: 0.7, fontSize: '0.85rem' }}>{p.razorpayPaymentId || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
};

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Navbar />
        <Routes>
          <Route path="/" element={<CheckoutPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
