FX = 19.0  # R/USD, Franklin's rate, for comparability

# ── Per-operator monthly activity (the "active operator" baseline) ──────────
CONV            = 200     # customer AI conversations
EMAIL_TXN       = 400     # 4 per booking x 100 bookings
EMAIL_MKT       = 2000    # 2 campaigns x 1000 contacts
EDGE_INV        = 1500    # bot turns + checkouts + webhooks
DB_MB_PER_MONTH = 1.5     # measured marginal, all tables
EGRESS_MB       = 150     # PostgREST JSON; page assets are Vercel's CDN
MAU             = 50      # my-bookings OTP customers + admins

# ── Measured unit costs ─────────────────────────────────────────────────────
# DeepSeek V4 Flash $0.14/M in, $0.28/M out. Measured ~1800 in / ~120 out per
# reply; a conversation is ~4 classifier calls + 2 replies.
AI_PER_CONV_USD = 4*(250*0.14e-6 + 12*0.28e-6) + 2*(1800*0.14e-6 + 120*0.28e-6)

SUPA_BASE, SUPA_EDGE_INC, SUPA_EDGE_RATE = 25.0, 2_000_000, 2.0/1_000_000
SUPA_DB_INC, SUPA_DB_RATE = 8.0, 0.125
SUPA_EGR_INC, SUPA_EGR_RATE = 250.0, 0.09
SUPA_MAU_INC, SUPA_MAU_RATE = 100_000, 0.00325
DB_FIXED_GB = 1.15
VERCEL_BASE = 20.0
OTHER_FIXED = 30.0   # Sentry, domains, misc

# Resend: (included, base, overage $/1k). Cheapest covering plan wins.
RESEND = [(3_000,0,0.90),(50_000,20,0.90),(100_000,35,0.90),(200_000,160,0.80),
          (500_000,350,0.70),(1_000_000,650,0.65),(1_500_000,825,0.52),(2_500_000,1150,0.46)]

def resend_cost(n):
    best=None
    for inc,base,over in RESEND:
        c = base + max(0, n-inc)/1000*over
        best = c if best is None else min(best,c)
    return best

def tranche(ops, months_accumulated=12):
    ai   = ops*CONV*AI_PER_CONV_USD
    mail = resend_cost(ops*(EMAIL_TXN+EMAIL_MKT))
    edge = max(0, ops*EDGE_INV + 70_000 - SUPA_EDGE_INC)*SUPA_EDGE_RATE
    dbgb = DB_FIXED_GB + ops*DB_MB_PER_MONTH*months_accumulated/1024
    db   = max(0, dbgb-SUPA_DB_INC)*SUPA_DB_RATE
    egr  = max(0, ops*EGRESS_MB/1024 - SUPA_EGR_INC)*SUPA_EGR_RATE
    mau  = max(0, ops*MAU - SUPA_MAU_INC)*SUPA_MAU_RATE
    supa = SUPA_BASE+edge+db+egr+mau
    verc = VERCEL_BASE + (ops*3000/1_000_000)*0.60   # ~$0.60/M invocations, region-dependent
    total= ai+mail+supa+verc+OTHER_FIXED
    return dict(ops=ops, ai=ai, mail=mail, supa=supa, verc=verc, other=OTHER_FIXED,
                total=total, dbgb=dbgb, emails=ops*(EMAIL_TXN+EMAIL_MKT))

print(f"AI per conversation: ${AI_PER_CONV_USD:.6f} = R{AI_PER_CONV_USD*FX:.4f}")
print()
hdr = f"{'Ops':>5} {'AI':>8} {'Email':>9} {'Supabase':>9} {'Vercel':>8} {'Other':>7} {'TOTAL/mo':>10} {'R/mo':>10} {'R/op':>8} {'Rev R':>11} {'Margin':>7}"
print(hdr); print("-"*len(hdr))
rows=[]
for ops in range(100,2001,100):
    t=tranche(ops)
    rand=t['total']*FX; rev=ops*2000
    rows.append((ops,t,rand,rev))
    print(f"{ops:>5} ${t['ai']:>7.2f} ${t['mail']:>8.2f} ${t['supa']:>8.2f} ${t['verc']:>7.2f} ${t['other']:>6.2f} ${t['total']:>9.2f} R{rand:>9,.0f} R{rand/ops:>7.2f} R{rev:>10,.0f} {100*(rev-rand)/rev:>6.1f}%")
