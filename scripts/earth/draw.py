# What the hand corrections of a region's tracing are written with (asia.fix.py, africa.fix.py...):
# the picture (T: '.' sea, '#' land, 'h' hills, '^' mountains, 'o' lake, ' ' another region's), its biomes (B, cell for
# cell, in mapPaint.ts's letters), the marks (M: where real places fall in it), and ways of drawing on them.
import json, os
D = os.path.dirname(os.path.abspath(__file__)) + '/'

class Picture:
    def __init__(self, name):
        self.name = name
        self.T = [list(l) for l in open(D + name + '.draft.txt').read().split('\n') if l]
        self.B = [list(l) for l in open(D + name + '.draft.biomes.txt').read().split('\n') if l]
        self.H, self.W = len(self.T), len(self.T[0])
        self.B0 = [row[:] for row in self.B]
        self.M = json.load(open(D + name + '.marks.json'))
    def at(self, mark, dc=0, dr=0):
        c, r = self.M[mark]
        return (c + dc, r + dr)
    def inside(self, c, r): return 0 <= r < self.H and 0 <= c < self.W
    def near(self, r, c, d='F'):
        # (The biome of the nearest land in the tracing: what is drawn anew takes its neighbours'.)
        for k in range(0, 14):
            for dr in range(-k, k + 1):
                for dc in range(-k, k + 1):
                    rr, cc = r + dr, c + dc
                    if self.inside(cc, rr) and self.B0[rr][cc] not in '. ': return self.B0[rr][cc]
        return d
    def sea(self, c, r):
        if self.inside(c, r) and self.T[r][c] != ' ': self.T[r][c] = '.'; self.B[r][c] = '.'
    def land(self, c, r, ch='#', b=None):
        if self.inside(c, r): self.T[r][c] = ch; self.B[r][c] = b or self.near(r, c)
    def clear(self, c0, c1, r0, r1):
        for r in range(int(r0), int(r1) + 1):
            for c in range(int(c0), int(c1) + 1): self.sea(c, r)
    def fill(self, c0, c1, r0, r1, ch='#', b=None):
        for r in range(int(r0), int(r1) + 1):
            for c in range(int(c0), int(c1) + 1): self.land(c, r, ch, b)
    def cells(self, pts, radius):
        # (Every cell within `radius` of the way through the points.)
        out = set()
        segs = list(zip(pts, pts[1:])) or [(pts[0], pts[0])]
        lo_c = int(min(p[0] for p in pts) - radius) - 1; hi_c = int(max(p[0] for p in pts) + radius) + 1
        lo_r = int(min(p[1] for p in pts) - radius) - 1; hi_r = int(max(p[1] for p in pts) + radius) + 1
        for r in range(lo_r, hi_r + 1):
            for c in range(lo_c, hi_c + 1):
                for (ax, ay), (bx, by) in segs:
                    dx, dy = bx - ax, by - ay
                    t = 0 if dx == 0 and dy == 0 else max(0, min(1, ((c - ax) * dx + (r - ay) * dy) / (dx * dx + dy * dy)))
                    if (c - ax - t * dx) ** 2 + (r - ay - t * dy) ** 2 <= radius * radius: out.add((c, r)); break
        return out
    def thick(self, pts, radius, ch='#', b=None):
        for c, r in self.cells(pts, radius): self.land(c, r, ch, b)
    def channel(self, pts, radius):
        for c, r in self.cells(pts, radius): self.sea(c, r)
    def ridge(self, pts, radius=0.6, ch='^'):
        for c, r in self.cells(pts, radius):
            if self.inside(c, r) and self.T[r][c] in '#h^': self.T[r][c] = ch
    def lower(self, c0, c1, r0, r1, keep=lambda c, r: False):
        # (Mountains to hills: the tracing's relief is coarse, and makes whole plateaus one mass.)
        for r in range(max(0, int(r0)), min(self.H, int(r1) + 1)):
            for c in range(max(0, int(c0)), min(self.W, int(c1) + 1)):
                if self.T[r][c] == '^' and not keep(c, r): self.T[r][c] = 'h'
    def save(self, head, biome_head):
        open(D + self.name + '.txt', 'w').write(head + '\n'.join(''.join(r) for r in self.T) + '\n')
        open(D + self.name + '.biomes.txt', 'w').write(biome_head + '\n'.join(''.join(r) for r in self.B) + '\n')

def _under(name):
    try: return [l for l in open(D + name + '.under.txt').read().split('\n') if l]
    except OSError: return []

def moat(p, radius=3.2, joins=()):
    # A strait between this region's land and the land of the regions drawn before it (<name>.under.txt): its own land
    # within `radius` characters of theirs goes under, except round the places where the two really join (`joins`:
    # (col, row, reach) each). So Gibraltar, Sicily's channel, the Red Sea keep themselves open.
    under = _under(p.name)
    if not under: return
    k = int(radius) + 1
    theirs = [(c, r) for r, row in enumerate(under) for c, ch in enumerate(row) if ch == '#']
    near = set()
    for c, r in theirs:
        for dr in range(-k, k + 1):
            for dc in range(-k, k + 1):
                if dc * dc + dr * dr <= radius * radius: near.add((c + dc, r + dr))
    for c, r in near:
        if not p.inside(c, r) or p.T[r][c] in '. ': continue
        if any((c - jc) ** 2 + (r - jr) ** 2 <= jw * jw for jc, jr, jw in joins): continue
        p.sea(c, r)

def inland(p, largest=10**9):
    # Seas of the picture shut in by its own land (not reaching its edge nor a blank) become lakes, up to `largest`
    # cells: left as sea, the game cuts a channel from each to the ocean.
    seen = [[False] * p.W for _ in range(p.H)]
    for r0 in range(p.H):
        for c0 in range(p.W):
            if seen[r0][c0] or p.T[r0][c0] != '.': continue
            comp, open_, stack = [], False, [(c0, r0)]
            seen[r0][c0] = True
            while stack:
                c, r = stack.pop(); comp.append((c, r))
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    cc, rr = c + dc, r + dr
                    if not p.inside(cc, rr) or p.T[rr][cc] == ' ': open_ = True; continue
                    if p.T[rr][cc] == '.' and not seen[rr][cc]: seen[rr][cc] = True; stack.append((cc, rr))
            if not open_ and len(comp) <= largest:
                for c, r in comp: p.T[r][c] = 'o'
