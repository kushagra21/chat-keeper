"""Builds the made-up sample chat (src/sample.ts) used by "Try a sample chat".

Run from the repo root: python3 scripts/make-sample.py   (macOS: uses sips to make the JPEGs)
"""
import base64, math, os, shutil, struct, subprocess, tempfile, zlib

LRM = '‎'
OUT = 'src/sample.ts'


def png(path, w, h, pixel):
    rows = b''.join(b'\x00' + bytes(c for x in range(w) for c in pixel(x, y)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def scene(sky_top, sky_bottom, hills, sun=None):
    def pixel(x, y):
        t = y / 300
        c = [int(a + (b - a) * t) for a, b in zip(sky_top, sky_bottom)]
        if sun and (x - sun[0]) ** 2 + (y - sun[1]) ** 2 < sun[2] ** 2:
            c = [255, 236, 170]
        for base, amp, freq, phase, col in hills:
            if y > base + amp * math.sin(x * freq + phase):
                c = list(col)
        return c
    return pixel


def jpeg(name, pixel, tmp):
    p = os.path.join(tmp, 'x.png')
    png(p, 400, 300, pixel)
    subprocess.run(['sips', '-s', 'format', 'jpeg', p, '--out', os.path.join(tmp, 'chat', name)], check=True, capture_output=True)


PDF = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 74>>stream
BT /F1 16 Tf 30 120 Td (Ridge loop: 14 km, 620 m up) Tj 0 -30 Td (Start 8:00 at the car park) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
"""

LINES = f"""[02/03/2024, 18:01:12] Hill Walk Club: {LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.
[02/03/2024, 18:01:12] Hill Walk Club: {LRM}Priya Nair created this group
[02/03/2024, 18:02:40] Hill Walk Club: {LRM}Priya Nair added Tom Okafor and Lena Brandt
[02/03/2024, 18:03:05] Priya Nair: Welcome! Saturday walk is on. Ridge loop, 14 km
[02/03/2024, 18:03:30] Priya Nair: {LRM}<attached: 00000007-DOCUMENT-ridge-loop.pdf>
[02/03/2024, 18:05:51] Tom Okafor: I'm in. What time?
[02/03/2024, 18:06:20] Priya Nair: 8:00 at the car park. Bring water, it's dry up there
[02/03/2024, 18:09:02] Lena Brandt: Count me in 🙌
Can I bring my sister?
[02/03/2024, 18:09:40] Priya Nair: Of course
[02/03/2024, 21:44:10] Tom Okafor: Forecast says clear skies https://example.com/forecast
[09/03/2024, 07:52:13] Lena Brandt: Running 5 min late, sorry!
[09/03/2024, 07:53:01] Priya Nair: No rush, we're getting coffee
[09/03/2024, 10:15:44] Tom Okafor: {LRM}<attached: 00000012-PHOTO-2024-03-09-10-15-44.jpg>
[09/03/2024, 10:16:02] Tom Okafor: View from the first saddle
[09/03/2024, 10:16:30] Lena Brandt: Wow
[09/03/2024, 12:40:09] Priya Nair: {LRM}<attached: 00000013-PHOTO-2024-03-09-12-40-09.jpg>
[09/03/2024, 12:40:30] Priya Nair: Lunch spot. Best one yet
[09/03/2024, 12:41:12] Lena Brandt: {LRM}image omitted
[09/03/2024, 16:02:55] Lena Brandt: Home. Legs are done 😅
[09/03/2024, 16:05:20] Tom Okafor: Same. Thanks for organising Priya
[09/03/2024, 16:05:41] Lena Brandt: {LRM}This message was deleted.
[09/03/2024, 16:06:10] Lena Brandt: Thank you Priya! Next month? {LRM}<This message was edited>
[10/03/2024, 09:12:00] Priya Nair: Yes. Coast path in April, sunset finish
[10/03/2024, 09:12:31] Priya Nair: {LRM}<attached: 00000014-PHOTO-2024-03-10-09-12-31.jpg>
[10/03/2024, 09:12:45] Priya Nair: Something like this
[10/03/2024, 09:20:03] Tom Okafor: {LRM}Missed voice call
[10/03/2024, 09:21:17] Tom Okafor: Sorry, pocket call
[13/04/2024, 19:30:00] Hill Walk Club: {LRM}Lena Brandt changed the group description
[13/04/2024, 19:31:22] Lena Brandt: Coast path tomorrow, meet at the harbour at 15:00
"""


def main():
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, 'chat'))
    jpeg('00000012-PHOTO-2024-03-09-10-15-44.jpg', scene((120, 170, 225), (205, 225, 240), [
        (170, 30, 0.012, 0.0, (110, 130, 150)), (210, 25, 0.02, 1.0, (70, 105, 80)), (255, 10, 0.03, 2.0, (50, 80, 55))]), tmp)
    jpeg('00000013-PHOTO-2024-03-09-12-40-09.jpg', scene((90, 150, 215), (190, 215, 235), [
        (200, 15, 0.015, 0.5, (95, 135, 90)), (240, 20, 0.01, 3.0, (140, 120, 80))], sun=(310, 70, 26)), tmp)
    jpeg('00000014-PHOTO-2024-03-10-09-12-31.jpg', scene((250, 160, 110), (255, 215, 160), [
        (190, 4, 0.05, 0.0, (60, 90, 140)), (250, 18, 0.008, 1.0, (190, 160, 110))], sun=(200, 180, 40)), tmp)
    with open(os.path.join(tmp, 'chat', '00000007-DOCUMENT-ridge-loop.pdf'), 'wb') as f:
        f.write(PDF)
    with open(os.path.join(tmp, 'chat', '_chat.txt'), 'w', encoding='utf-8') as f:
        f.write(LINES)
    z = os.path.join(tmp, 'sample.zip')
    subprocess.run(['zip', '-q', '-X', '-r', z, '.'], cwd=os.path.join(tmp, 'chat'), check=True)
    data = base64.b64encode(open(z, 'rb').read()).decode()
    with open(OUT, 'w') as f:
        f.write('// Made-up sample chat for "Try a sample chat". Generated by scripts/make-sample.py.\n')
        f.write(f"export const sampleZip = 'data:application/zip;base64,{data}';\n")
    shutil.rmtree(tmp)
    print(f'wrote {OUT} ({len(data) // 1024} KB)')


main()
