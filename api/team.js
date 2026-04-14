// Team Management API
// Routes by ?action=: invite, accept, list, remove, update-role, check-invites
//
// Uses service client for cross-business lookups (invites by email)
// Uses user client for RLS-scoped operations

const { authenticate, getServiceClient, createUserClient } = require('./_lib/auth');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { userId, businessId } = await authenticate(req);
    const action = req.query.action;
    const service = getServiceClient();

    switch (action) {

      // ── INVITE a team member by email ──
      case 'invite': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

        const { email, role } = req.body || {};
        if (!email || !role) return res.status(400).json({ error: 'email and role required' });

        const validRoles = ['manager', 'staff', 'viewer'];
        if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role. Must be manager, staff, or viewer' });

        // Check caller is owner or manager
        const callerRole = await getMemberRole(service, userId, businessId);
        if (callerRole !== 'owner' && callerRole !== 'manager') {
          return res.status(403).json({ error: 'Only owners and managers can invite team members' });
        }
        // Managers can't invite managers
        if (callerRole === 'manager' && role === 'manager') {
          return res.status(403).json({ error: 'Managers cannot invite other managers' });
        }

        // Check if already invited or a member
        const { data: existing } = await service
          .from('team_members')
          .select('id, status')
          .eq('business_id', businessId)
          .eq('email', email.toLowerCase())
          .maybeSingle();

        if (existing) {
          if (existing.status === 'accepted') return res.status(409).json({ error: 'This person is already a team member' });
          if (existing.status === 'pending') return res.status(409).json({ error: 'An invite is already pending for this email' });
        }

        // Get business name for the invite
        const { data: biz } = await service.from('businesses').select('name').eq('id', businessId).single();

        const { data: invite, error: invErr } = await service
          .from('team_members')
          .insert({
            business_id: businessId,
            email: email.toLowerCase(),
            role,
            status: 'pending',
            invited_by: userId,
            invited_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (invErr) throw invErr;
        return res.status(201).json({ ...invite, businessName: biz?.name });
      }

      // ── ACCEPT an invite ──
      case 'accept': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

        const { inviteId } = req.body || {};
        if (!inviteId) return res.status(400).json({ error: 'inviteId required' });

        // Get the user's email
        const { data: { user }, error: userErr } = await service.auth.admin.getUserById(userId);
        if (userErr || !user) return res.status(400).json({ error: 'Could not verify user email' });

        // Get the invite (must match user email and be pending)
        const { data: invite, error: invErr } = await service
          .from('team_members')
          .select('*')
          .eq('id', inviteId)
          .eq('email', user.email.toLowerCase())
          .eq('status', 'pending')
          .single();

        if (invErr || !invite) return res.status(404).json({ error: 'Invite not found or already accepted' });

        // Update invite
        const { data: updated, error: upErr } = await service
          .from('team_members')
          .update({
            user_id: userId,
            status: 'accepted',
            accepted_at: new Date().toISOString(),
          })
          .eq('id', inviteId)
          .select()
          .single();

        if (upErr) throw upErr;
        return res.status(200).json(updated);
      }

      // ── LIST all team members for the business ──
      case 'list': {
        if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

        // Get the business owner info
        const { data: biz } = await service
          .from('businesses')
          .select('id, name, auth_user_id')
          .eq('id', businessId)
          .single();

        // Get owner email
        let ownerEmail = '';
        if (biz?.auth_user_id) {
          try {
            const { data: { user: ownerUser } } = await service.auth.admin.getUserById(biz.auth_user_id);
            ownerEmail = ownerUser?.email || '';
          } catch (e) { /* ignore */ }
        }

        // Get all team members
        const { data: members, error } = await service
          .from('team_members')
          .select('*')
          .eq('business_id', businessId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        // Include owner as first entry
        const result = [
          {
            id: 'owner',
            email: ownerEmail,
            role: 'owner',
            status: 'accepted',
            user_id: biz?.auth_user_id,
            isOwner: true,
          },
          ...members,
        ];

        return res.status(200).json(result);
      }

      // ── REMOVE a team member ──
      case 'remove': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

        const { memberId } = req.body || {};
        if (!memberId) return res.status(400).json({ error: 'memberId required' });

        // Check caller is owner
        const callerRole2 = await getMemberRole(service, userId, businessId);
        if (callerRole2 !== 'owner') {
          return res.status(403).json({ error: 'Only owners can remove team members' });
        }

        const { error: delErr } = await service
          .from('team_members')
          .delete()
          .eq('id', memberId)
          .eq('business_id', businessId);

        if (delErr) throw delErr;
        return res.status(200).json({ success: true, id: memberId });
      }

      // ── UPDATE ROLE ──
      case 'update-role': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

        const { memberId: mId, role: newRole } = req.body || {};
        if (!mId || !newRole) return res.status(400).json({ error: 'memberId and role required' });

        const validRoles2 = ['manager', 'staff', 'viewer'];
        if (!validRoles2.includes(newRole)) return res.status(400).json({ error: 'Invalid role' });

        // Check caller is owner
        const callerRole3 = await getMemberRole(service, userId, businessId);
        if (callerRole3 !== 'owner') {
          return res.status(403).json({ error: 'Only owners can change roles' });
        }

        const { data: updated2, error: upErr2 } = await service
          .from('team_members')
          .update({ role: newRole })
          .eq('id', mId)
          .eq('business_id', businessId)
          .select()
          .single();

        if (upErr2) throw upErr2;
        return res.status(200).json(updated2);
      }

      // ── CHECK INVITES for current user (called on login) ──
      case 'check-invites': {
        if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

        // Get the user's email
        const { data: { user: authUser }, error: authErr } = await service.auth.admin.getUserById(userId);
        if (authErr || !authUser) return res.status(200).json({ invites: [] });

        // Find pending invites for this email
        const { data: invites, error: invError } = await service
          .from('team_members')
          .select('*, businesses!inner(name)')
          .eq('email', authUser.email.toLowerCase())
          .eq('status', 'pending');

        if (invError) throw invError;

        // Map to include business name
        const mapped = (invites || []).map(inv => ({
          id: inv.id,
          businessId: inv.business_id,
          businessName: inv.businesses?.name || 'Unknown Business',
          role: inv.role,
          email: inv.email,
          invitedAt: inv.invited_at,
        }));

        return res.status(200).json({ invites: mapped });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Team API error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
};

// Helper: get a user's role for a business (owner check via businesses table, then team_members)
async function getMemberRole(service, userId, businessId) {
  // Check if user is the business owner
  const { data: biz } = await service
    .from('businesses')
    .select('auth_user_id')
    .eq('id', businessId)
    .single();

  if (biz && biz.auth_user_id === userId) return 'owner';

  // Check team_members
  const { data: member } = await service
    .from('team_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .single();

  return member?.role || null;
}
