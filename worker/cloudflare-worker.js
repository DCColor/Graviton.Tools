// Graviton.tools — Cloudflare Worker
// Handles: (1) waitlist signups → Monday.com
//          (2) contact form → email via Resend

export default {
  async fetch(request, env) {

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { action } = body;

      console.log('Worker received body:', JSON.stringify(body), '| action:', action);

      // Route to correct handler
      if (action === 'contact') {
        return await handleContact(body, env, corsHeaders);
      } else {
        // Handles both action:'waitlist' and no action field (backward compat)
        return await handleWaitlist(body, env, corsHeaders);
      }

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: 'Server error', detail: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// ── Waitlist handler → Monday.com ──────────────────────────────────────────
async function handleWaitlist(body, env, corsHeaders) {
  const { email, firstName, lastName } = body;

  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const today = new Date().toISOString().split('T')[0];

  const columnValues = {
    email_mm34jqea: { email: email, text: email },
    text_mm34smsk: firstName || '',
    text_mm34jg1k: lastName || '',
    date4: { date: today }
  };

  const itemName = (firstName || lastName)
    ? `${firstName || ''} ${lastName || ''}`.trim()
    : email;

  const query = `
    mutation {
      create_item(
        board_id: 18412247742,
        item_name: "${itemName.replace(/"/g, '\\"')}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }
  `;

  const mondayResponse = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': env.MONDAY_API_KEY,
      'API-Version': '2024-01'
    },
    body: JSON.stringify({ query })
  });

  const mondayData = await mondayResponse.json();

  if (mondayData.errors) {
    console.error('Monday API error:', JSON.stringify(mondayData.errors));
    return new Response(JSON.stringify({ error: 'Failed to save' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ── Contact handler → Resend email ────────────────────────────────────────
async function handleContact(body, env, corsHeaders) {
  const { contactType, name, email, subject, message } = body;

  if (!email || !message || !contactType) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Route based on contact type
  // Match both full label and shorthand value the form may send
  const isProductQuestion = contactType === 'Question about a product'
    || contactType === 'product-question'
    || contactType.toLowerCase().includes('product');

  const toAddress = isProductQuestion
    ? 'sales@graviton.tools'
    : 'support@graviton.tools';

  const emailBody = `
New contact form submission from graviton.tools

Type: ${contactType}
Name: ${name || 'Not provided'}
Email: ${email}
Subject: ${subject || 'Not provided'}

Message:
${message}
  `.trim();

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Graviton.tools Contact <noreply@graviton.tools>',
      to: toAddress,
      reply_to: email,
      subject: `[Graviton] ${contactType}: ${subject || '(no subject)'}`,
      text: emailBody
    })
  });

  const resendData = await resendResponse.json();

  if (!resendResponse.ok) {
    console.error('Resend error:', JSON.stringify(resendData));
    return new Response(JSON.stringify({ error: 'Failed to send' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
