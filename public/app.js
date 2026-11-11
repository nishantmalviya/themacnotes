const $ = (id) => document.getElementById(id);
const msg = (t) => ($('msg').textContent = t);

function unlock(token) {
  localStorage.setItem('dl_token', token);
  const b = $('download');
  b.disabled = false;
  b.classList.remove('disabled');
  b.textContent = '⬇ Download Notepad for macOS';
  b.onclick = () => (location.href = `/download?token=${encodeURIComponent(token)}`);
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

(async () => {
  const saved = localStorage.getItem('dl_token');
  if (saved) unlock(saved);

  const cfg = await (await fetch('/api/config')).json();

  const support = $('support-note');
  if (support && cfg.supportEmail) support.innerHTML = `Questions or issues? <a href="mailto:${cfg.supportEmail}">${cfg.supportEmail}</a>`;

  if (cfg.stripe) {
    $('card').hidden = false;
    $('card').onclick = async () => {
      try { location.href = (await post('/api/stripe/checkout')).url; } catch (e) { msg(e.message); }
    };
  }

  if (cfg.paypalClientId) {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${cfg.paypalClientId}&currency=USD`;
    s.onload = () => paypal.Buttons({
      createOrder: async () => (await post('/api/paypal/create-order')).id,
      onApprove: async (data) => {
        try { unlock((await post('/api/paypal/capture-order', { orderID: data.orderID })).token); msg(''); }
        catch (e) { msg(e.message); }
      },
      onError: () => msg('PayPal payment failed.'),
    }).render('#paypal');
    document.head.appendChild(s);
  }

  if (cfg.demo) {
    $('demo').hidden = false;
    $('demo').onclick = async () => {
      try { unlock((await post('/api/demo/pay')).token); msg(''); } catch (e) { msg(e.message); }
    };
    msg('Demo mode (no payment keys configured).');
    $('msg').style.color = '#9a9ab0';
  } else if (!cfg.stripe && !cfg.paypalClientId) msg('Payments are not configured yet.');
})();
