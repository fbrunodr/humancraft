# A window of a region's picture, with the marks in it (scripts/earth/<region>.marks.json) shown as letters and listed:
#   python3 scripts/earth/view.py <region> <col0> <col1> <row0> <row1> [draft]
import json, os, sys
D = os.path.dirname(os.path.abspath(__file__)) + '/'
name, c0, c1, r0, r1 = sys.argv[1], *map(int, sys.argv[2:6])
f = name + ('.draft.txt' if len(sys.argv) > 6 else '.txt')
rows = [l for l in open(D + f).read().split('\n') if not l.startswith(';')]
marks = json.load(open(D + name + '.marks.json'))
letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgijklmnpqrstuvwxyz0123456789'
inside = [(k, v) for k, v in marks.items() if c0 <= v[0] <= c1 and r0 <= v[1] <= r1][:len(letters)]
at = {(v[0], v[1]): letters[i] for i, (k, v) in enumerate(inside)}
print('    ' + ''.join(str((c // 10) % 10) if c % 10 == 0 else ' ' for c in range(c0, c1 + 1)))
for r in range(r0, min(r1 + 1, len(rows))):
    line = rows[r].ljust(c1 + 1)
    print('%3d ' % r + ''.join(at.get((c, r), line[c]) for c in range(c0, c1 + 1)))
print(' '.join('%s=%s(%d,%d)' % (letters[i], k, v[0], v[1]) for i, (k, v) in enumerate(inside)))
