import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in.' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.replace('Bearer ', '');

    // Create Supabase client and verify user
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (authError || !authUser) {
      return NextResponse.json(
        { error: 'Invalid session. Please sign in again.' },
        { status: 401 }
      );
    }

    // Get phone number from request body
    const { phone_number } = await request.json();

    if (!phone_number || typeof phone_number !== 'string') {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      );
    }

    const normalizedPhone = phone_number.trim();

    // Validate phone number format (basic check)
    if (!normalizedPhone.match(/^\+?[1-9]\d{1,14}$/)) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Include country code (e.g., +1234567890)' },
        { status: 400 }
      );
    }

    // Use service role client for whatsapp_users table (no RLS on this table)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if phone number already exists
    const { data: existingWhatsAppUser } = await supabaseAdmin
      .from('whatsapp_users')
      .select('id, auth_user_id')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (existingWhatsAppUser) {
      // Phone number exists
      if (existingWhatsAppUser.auth_user_id) {
        // Already linked
        if (existingWhatsAppUser.auth_user_id === authUser.id) {
          // Already linked to this user - idempotent success
          return NextResponse.json({
            success: true,
            message: 'Phone number already linked to your account',
          });
        } else {
          // Linked to different user
          return NextResponse.json(
            { error: 'Phone number already linked to another account' },
            { status: 409 }
          );
        }
      } else {
        // Exists but unlinked - link it now
        const { error: updateError } = await supabaseAdmin
          .from('whatsapp_users')
          .update({ auth_user_id: authUser.id })
          .eq('id', existingWhatsAppUser.id);

        if (updateError) {
          console.error('Error linking WhatsApp user:', updateError);
          return NextResponse.json(
            { error: 'Failed to link phone number' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          message: 'WhatsApp linked successfully',
        });
      }
    } else {
      // Phone number doesn't exist - create new record with link
      const { error: insertError } = await supabaseAdmin
        .from('whatsapp_users')
        .insert({
          phone_number: normalizedPhone,
          auth_user_id: authUser.id,
          daily_digest_enabled: false,
        });

      if (insertError) {
        console.error('Error creating WhatsApp user:', insertError);
        return NextResponse.json(
          { error: 'Failed to link phone number' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'WhatsApp linked successfully',
      });
    }
  } catch (error: any) {
    console.error('Error in link-whatsapp API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
