// Fanta Alpine Ski — a small PDF text reader, written in plain ES5 so it works on any phone (old Safari included).
// Made for the FIS results PDF (Swiss Timing / Longines), but it follows the PDF rules, not that layout:
// objects (also inside compressed object streams), Flate-compressed contents, the text operators with their positions,
// fonts with ToUnicode maps (two-byte Type0 fonts and simple fonts), text inside form XObjects.
// PDFText.read(arrayBuffer) returns the pages, each a list of pieces of text shaped like PDF.js getTextContent items:
// {str, transform: [1, 0, 0, height, x, y]} (y grows upwards, as in PDF). It throws when something is beyond it,
// and the page falls back to PDF.js.
(function (root) {
  'use strict';

  // ---------- inflate (RFC 1950 zlib wrapper around RFC 1951 deflate)
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huff(lengths, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
    return { count: count, symbol: symbol };
  }
  var FIXED = null;
  function fixed() {
    if (FIXED) return FIXED;
    var l = new Uint8Array(288), d = new Uint8Array(30), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED = { lit: huff(l, 288), dist: huff(d, 30) };
    return FIXED;
  }
  function inflate(data) {
    var pos = 0, bitbuf = 0, bitcnt = 0, out = new Uint8Array(Math.max(4096, data.length * 4)), op = 0;
    // zlib header (method 8, check bits); a bare deflate stream is read as it is
    if (data.length > 2 && (data[0] & 15) === 8 && ((data[0] << 8) | data[1]) % 31 === 0) pos = 2;
    function bits(n) {
      while (bitcnt < n) {
        if (pos >= data.length) throw new Error('inflate: data ended');
        bitbuf |= data[pos++] << bitcnt; bitcnt += 8;
      }
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n; bitcnt -= n;
      return v;
    }
    function room(n) {
      if (op + n <= out.length) return;
      var o2 = new Uint8Array(Math.max(out.length * 2, op + n));
      o2.set(out); out = o2;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0, len, cnt;
      for (len = 1; len < 16; len++) {
        code |= bits(1);
        cnt = h.count[len];
        if (code - cnt < first) return h.symbol[index + (code - first)];
        index += cnt; first += cnt; first <<= 1; code <<= 1;
      }
      throw new Error('inflate: bad code');
    }
    function codes(lit, dist) {
      for (;;) {
        var sym = decode(lit);
        if (sym < 256) { room(1); out[op++] = sym; continue; }
        if (sym === 256) return;
        sym -= 257;
        if (sym >= 29) throw new Error('inflate: bad length');
        var len = LBASE[sym] + bits(LEXT[sym]), ds = decode(dist);
        if (ds >= 30) throw new Error('inflate: bad distance');
        var dd = DBASE[ds] + bits(DEXT[ds]);
        if (dd > op) throw new Error('inflate: distance too far');
        room(len);
        for (var k = 0; k < len; k++) { out[op] = out[op - dd]; op++; }
      }
    }
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > data.length) throw new Error('inflate: data ended');
        var len = data[pos] | (data[pos + 1] << 8);
        pos += 4;
        if (pos + len > data.length) throw new Error('inflate: data ended');
        room(len);
        out.set(data.subarray(pos, pos + len), op);
        op += len; pos += len;
      } else if (type === 1) {
        var f = fixed();
        codes(f.lit, f.dist);
      } else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lengths = new Uint8Array(320), i;
        for (i = 0; i < ncode; i++) lengths[ORDER[i]] = bits(3);
        for (; i < 19; i++) lengths[ORDER[i]] = 0;
        var lencode = huff(lengths, 19), idx = 0;
        lengths = new Uint8Array(320);
        while (idx < nlen + ndist) {
          var sym = decode(lencode);
          if (sym < 16) { lengths[idx++] = sym; continue; }
          var rep = 0, val = 0;
          if (sym === 16) { if (!idx) throw new Error('inflate: repeat without length'); val = lengths[idx - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (idx + rep > nlen + ndist) throw new Error('inflate: too many lengths');
          while (rep--) lengths[idx++] = val;
        }
        codes(huff(lengths.subarray(0, nlen), nlen), huff(lengths.subarray(nlen, nlen + ndist), ndist));
      } else throw new Error('inflate: bad block');
    } while (!last);
    return out.subarray(0, op);
  }

  // ---------- objects and syntax
  function Name(n) { this.n = n; }
  function Ref(n) { this.n = n; }
  function Str(b) { this.b = b; }
  function Dict() { this.m = {}; }
  function Op(v) { this.v = v; }
  function isWS(c) { return c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32; }
  function isDelim(c) { return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }
  function hexv(c) { return c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1; }
  var NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;

  function Lexer(b, p) { this.b = b; this.p = p || 0; }
  Lexer.prototype.ws = function () {
    var b = this.b, n = b.length;
    while (this.p < n) {
      var c = b[this.p];
      if (c === 37) { while (this.p < n && b[this.p] !== 10 && b[this.p] !== 13) this.p++; }
      else if (isWS(c)) this.p++;
      else break;
    }
  };
  // one token: {k: 'n'|'name'|'str'|'kw'|'['|']'|'<<'|'>>'|'{'|'}', v}
  Lexer.prototype.tok = function () {
    this.ws();
    var b = this.b, n = b.length;
    if (this.p >= n) return null;
    var c = b[this.p], s = '', start;
    if (c === 91 || c === 93 || c === 123 || c === 125) { this.p++; return { k: String.fromCharCode(c) }; }
    if (c === 60 && b[this.p + 1] === 60) { this.p += 2; return { k: '<<' }; }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { k: '>>' }; }
    if (c === 47) {
      this.p++;
      while (this.p < n && !isWS(b[this.p]) && !isDelim(b[this.p])) {
        var ch = b[this.p];
        if (ch === 35 && hexv(b[this.p + 1]) >= 0 && hexv(b[this.p + 2]) >= 0) { s += String.fromCharCode(hexv(b[this.p + 1]) * 16 + hexv(b[this.p + 2])); this.p += 3; }
        else { s += String.fromCharCode(ch); this.p++; }
      }
      return { k: 'name', v: s };
    }
    if (c === 40) return { k: 'str', v: this.lit() };
    if (c === 60) {
      var out = [], hi = -1;
      this.p++;
      while (this.p < n && b[this.p] !== 62) {
        var h = hexv(b[this.p++]);
        if (h < 0) continue;
        if (hi < 0) hi = h; else { out.push(hi * 16 + h); hi = -1; }
      }
      this.p++;
      if (hi >= 0) out.push(hi * 16);
      return { k: 'str', v: out };
    }
    if (c === 41 || c === 62) { this.p++; return this.tok(); }
    start = this.p;
    while (this.p < n && !isWS(b[this.p]) && !isDelim(b[this.p])) this.p++;
    if (this.p === start) { this.p++; return this.tok(); }
    for (var i = start; i < this.p; i++) s += String.fromCharCode(b[i]);
    return NUM.test(s) ? { k: 'n', v: parseFloat(s) } : { k: 'kw', v: s };
  };
  // a literal string: nested brackets, escapes, end-of-line markers read as a line feed
  Lexer.prototype.lit = function () {
    var b = this.b, n = b.length, out = [], depth = 1;
    this.p++;
    while (this.p < n) {
      var c = b[this.p++];
      if (c === 92) {
        var e = b[this.p++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
        else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e === 13) { if (b[this.p] === 10) this.p++; }
        else if (e === 10) { /* line continuation */ }
        else if (e >= 48 && e <= 55) {
          var v = e - 48;
          if (b[this.p] >= 48 && b[this.p] <= 55) { v = v * 8 + b[this.p++] - 48; if (b[this.p] >= 48 && b[this.p] <= 55) v = v * 8 + b[this.p++] - 48; }
          out.push(v & 255);
        } else out.push(e);
      } else if (c === 40) { depth++; out.push(c); }
      else if (c === 41) { if (--depth === 0) break; out.push(c); }
      else if (c === 13) { if (b[this.p] === 10) this.p++; out.push(10); }
      else out.push(c);
    }
    return out;
  };
  function parseFrom(lx, t) {
    if (!t) return null;
    if (t.k === 'n') {
      var save = lx.p, t2 = lx.tok();
      if (t2 && t2.k === 'n') { var t3 = lx.tok(); if (t3 && t3.k === 'kw' && t3.v === 'R') return new Ref(t.v); }
      lx.p = save;
      return t.v;
    }
    if (t.k === '[') {
      var arr = [];
      for (;;) { var a = lx.tok(); if (!a || a.k === ']') break; arr.push(parseFrom(lx, a)); }
      return arr;
    }
    if (t.k === '<<') {
      var d = new Dict();
      for (;;) {
        var key = lx.tok();
        if (!key || key.k === '>>') break;
        if (key.k !== 'name') continue;
        d.m[key.v] = parseFrom(lx, lx.tok());
      }
      return d;
    }
    if (t.k === 'name') return new Name(t.v);
    if (t.k === 'str') return new Str(t.v);
    if (t.k === 'kw') return t.v === 'true' ? true : t.v === 'false' ? false : t.v === 'null' ? null : new Op(t.v);
    return null;
  }
  function latin1(b) {
    var s = '', i, CH = 8192;
    for (i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, Array.prototype.slice.call(b.subarray(i, Math.min(b.length, i + CH))));
    return s;
  }

  // ---------- the document
  function Doc(buf) {
    var b = this.b = new Uint8Array(buf), s = latin1(b), re = /(\d+)\s+(\d+)\s+obj\b/g, m, objs = this.objs = {};
    if (s.indexOf('%PDF') < 0) throw new Error('non è un PDF');
    if (/\/Encrypt\b/.test(s)) throw new Error('PDF protetto');
    while ((m = re.exec(s))) {
      var lx = new Lexer(b, m.index + m[0].length), val = parseFrom(lx, lx.tok()), save = lx.p, t = lx.tok();
      if (t && t.k === 'kw' && t.v === 'stream' && val instanceof Dict) {
        var p = lx.p, len = val.m.Length, end = -1;
        if (b[p] === 13) p++;
        if (b[p] === 10) p++;
        if (typeof len === 'number' && /^\s*endstream/.test(s.substr(p + len, 40))) end = p + len;
        else {
          end = s.indexOf('endstream', p);
          if (end < 0) continue;
          if (b[end - 1] === 10) end--;
          if (b[end - 1] === 13) end--;
        }
        val.data = b.subarray(p, end);
        re.lastIndex = end;
      } else lx.p = save;
      objs[+m[1]] = val;
    }
    // objects kept inside compressed object streams
    var self = this;
    Object.keys(objs).forEach(function (k) {
      var o = objs[k];
      if (!(o instanceof Dict) || !o.data || self.name(o.m.Type) !== 'ObjStm') return;
      var d = self.stream(o), lx = new Lexer(d, 0), n = self.get(o.m.N), first = self.get(o.m.First), hdr = [], i;
      for (i = 0; i < n; i++) { var a = lx.tok(), c = lx.tok(); if (!a || !c) break; hdr.push([a.v, c.v]); }
      hdr.forEach(function (h) { if (objs[h[0]] === undefined) { var l2 = new Lexer(d, first + h[1]); objs[h[0]] = parseFrom(l2, l2.tok()); } });
    });
  }
  Doc.prototype.get = function (v) { var guard = 0; while (v instanceof Ref && guard++ < 32) v = this.objs[v.n]; return v; };
  Doc.prototype.name = function (v) { v = this.get(v); return v instanceof Name ? v.n : null; };
  Doc.prototype.dict = function (v) { v = this.get(v); return v instanceof Dict ? v : null; };
  // the decoded data of a stream (Flate, ASCIIHex, or none)
  Doc.prototype.stream = function (o) {
    o = this.get(o);
    if (!(o instanceof Dict) || !o.data) return new Uint8Array(0);
    var f = this.get(o.m.Filter), list = f ? (Array.isArray(f) ? f : [f]) : [], d = o.data, self = this;
    list.forEach(function (x, i) {
      var nm = self.name(x), parms = self.get(o.m.DecodeParms);
      if (Array.isArray(parms)) parms = self.get(parms[i]);
      if (nm === 'FlateDecode' || nm === 'Fl') {
        d = inflate(d);
        var pred = parms instanceof Dict ? self.get(parms.m.Predictor) : 0;
        if (pred && pred > 1) throw new Error('PDF con predittore non gestito');
      } else if (nm === 'ASCIIHexDecode' || nm === 'AHx') {
        var out = [], hi = -1;
        for (var k = 0; k < d.length && d[k] !== 62; k++) { var h = hexv(d[k]); if (h < 0) continue; if (hi < 0) hi = h; else { out.push(hi * 16 + h); hi = -1; } }
        if (hi >= 0) out.push(hi * 16);
        d = new Uint8Array(out);
      } else throw new Error('filtro ' + nm + ' non gestito');
    });
    return d;
  };
  Doc.prototype.pages = function () {
    var self = this, cat = null, out = [], seen = {};
    Object.keys(this.objs).forEach(function (k) { var o = self.objs[k]; if (o instanceof Dict && self.name(o.m.Type) === 'Catalog') cat = o; });
    if (!cat) throw new Error('PDF senza catalogo');
    (function walk(node, res, depth) {
      if (depth > 32) return;
      if (node instanceof Ref) { if (seen[node.n]) return; seen[node.n] = 1; }
      var d = self.dict(node);
      if (!d) return;
      var r = d.m.Resources !== undefined ? self.dict(d.m.Resources) : res, kids = self.get(d.m.Kids);
      if (Array.isArray(kids)) kids.forEach(function (k) { walk(k, r, depth + 1); });
      else out.push({ d: d, res: r });
    })(cat.m.Pages, null, 0);
    return out;
  };
  // a font: two-byte codes or one byte, code → text (ToUnicode, else Latin-1), code → width in text space units
  Doc.prototype.font = function (ref) {
    var key = ref instanceof Ref ? ref.n : null;
    this.fonts = this.fonts || {};
    if (key !== null && this.fonts[key]) return this.fonts[key];
    var f = this.dict(ref) || new Dict(), self = this, two = this.name(f.m.Subtype) === 'Type0', map = {}, widths = {}, dw = two ? 1000 : 0;
    if (f.m.ToUnicode) {
      // destination: UTF-16BE in hex (four digits per code unit; two digits for a single byte)
      var cm = latin1(this.stream(f.m.ToUnicode)), m, re, hx = function (h) {
        if (h.length <= 2) return h ? String.fromCharCode(parseInt(h, 16)) : '';
        var s = '';
        for (var i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16));
        return s;
      };
      re = /beginbfchar([\s\S]*?)endbfchar/g;
      while ((m = re.exec(cm))) { var pr = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g, q; while ((q = pr.exec(m[1]))) map[parseInt(q[1], 16)] = hx(q[2]); }
      re = /beginbfrange([\s\S]*?)endbfrange/g;
      while ((m = re.exec(cm))) {
        var rr = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g, x;
        while ((x = rr.exec(m[1]))) {
          var lo = parseInt(x[1], 16), hi = parseInt(x[2], 16), dst = x[3];
          if (hi - lo > 65535) continue;
          if (dst.charAt(0) === '[') {
            var parts = dst.match(/<([0-9a-fA-F]*)>/g) || [];
            for (var c = lo; c <= hi && c - lo < parts.length; c++) map[c] = hx(parts[c - lo].replace(/[<>]/g, ''));
          } else {
            var base = hx(dst.replace(/[<>]/g, ''));
            for (var c2 = lo; c2 <= hi; c2++) map[c2] = base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c2 - lo));
          }
        }
      }
    }
    if (two) {
      var desc = this.get(f.m.DescendantFonts), cf = this.dict(Array.isArray(desc) ? desc[0] : desc);
      if (cf) {
        if (typeof this.get(cf.m.DW) === 'number') dw = this.get(cf.m.DW);
        var w = this.get(cf.m.W);
        if (Array.isArray(w)) {
          for (var i = 0; i < w.length;) {
            var a = this.get(w[i]), b2 = this.get(w[i + 1]);
            if (Array.isArray(b2)) { for (var j = 0; j < b2.length; j++) widths[a + j] = this.get(b2[j]); i += 2; }
            else { var wv = this.get(w[i + 2]); for (var k = a; k <= b2 && k - a < 65536; k++) widths[k] = wv; i += 3; }
          }
        }
      }
    } else {
      var fc = this.get(f.m.FirstChar) || 0, ws = this.get(f.m.Widths), fd = this.dict(f.m.FontDescriptor);
      if (Array.isArray(ws)) for (var z = 0; z < ws.length; z++) widths[fc + z] = this.get(ws[z]);
      if (fd && typeof this.get(fd.m.MissingWidth) === 'number') dw = this.get(fd.m.MissingWidth);
    }
    var font = {
      two: two,
      text: function (code) { return map[code] !== undefined ? map[code] : two ? '' : String.fromCharCode(code); },
      width: function (code) { return (widths[code] !== undefined ? widths[code] : dw) / 1000; }
    };
    if (key !== null) this.fonts[key] = font;
    return font;
  };

  // ---------- the text of a content stream, with its positions
  function mul(m, n) {
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }
  Doc.prototype.run = function (bytes, res, ctm0, items, depth) {
    var self = this, lx = new Lexer(bytes, 0), ops = [], ctm = ctm0.slice(), stack = [];
    var tm = [1, 0, 0, 1, 0, 0], tlm = tm.slice(), tl = 0, tc = 0, tw = 0, tz = 1, font = null, size = 0, rise = 0;
    var fontsDict = res ? this.dict(res.m.Font) : null, xobjs = res ? this.dict(res.m.XObject) : null;
    function move(tx, ty) { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm.slice(); }
    function show(parts) {
      if (!font) return;
      var trm = mul([size * tz, 0, 0, size, 0, rise], mul(tm, ctm)), text = '', adv = 0;
      parts.forEach(function (p) {
        if (typeof p === 'number') { var sh = -p / 1000 * size * tz; adv += sh; if (p < -200 && text && text.charAt(text.length - 1) !== ' ') text += ' '; return; }
        var b = p.b, i, code;
        for (i = 0; i < b.length; i += font.two ? 2 : 1) {
          code = font.two ? (b[i] << 8) | (b[i + 1] || 0) : b[i];
          text += font.text(code);
          adv += (font.width(code) * size + tc + (!font.two && code === 32 ? tw : 0)) * tz;
        }
      });
      if (text.replace(/\s+/g, '')) items.push({ str: text, transform: [1, 0, 0, Math.abs(Math.sqrt(trm[2] * trm[2] + trm[3] * trm[3])) || size, trm[4], trm[5]] });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
    for (;;) {
      var t = lx.tok();
      if (!t) break;
      var v = parseFrom(lx, t);
      if (!(v instanceof Op)) { ops.push(v); continue; }
      var o = v.v, a = ops;
      ops = [];
      switch (o) {
        case 'q': stack.push(ctm.slice()); break;
        case 'Q': if (stack.length) ctm = stack.pop(); break;
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case 'Tf': font = fontsDict && a[0] instanceof Name ? self.font(fontsDict.m[a[0].n]) : null; size = a[1] || 0; break;
        case 'TL': tl = a[0] || 0; break;
        case 'Tc': tc = a[0] || 0; break;
        case 'Tw': tw = a[0] || 0; break;
        case 'Tz': tz = (a[0] === undefined ? 100 : a[0]) / 100; break;
        case 'Ts': rise = a[0] || 0; break;
        case 'Td': move(a[0] || 0, a[1] || 0); break;
        case 'TD': tl = -(a[1] || 0); move(a[0] || 0, a[1] || 0); break;
        case 'Tm': if (a.length >= 6) { tlm = a.slice(-6); tm = tlm.slice(); } break;
        case 'T*': move(0, -tl); break;
        case 'Tj': if (a[0] instanceof Str) show([a[0]]); break;
        case 'TJ': if (Array.isArray(a[0])) show(a[0].filter(function (x) { return x instanceof Str || typeof x === 'number'; })); break;
        case "'": move(0, -tl); if (a[0] instanceof Str) show([a[0]]); break;
        case '"': tw = a[0] || 0; tc = a[1] || 0; move(0, -tl); if (a[2] instanceof Str) show([a[2]]); break;
        case 'BI': {
          // inline image: its data is skipped up to EI
          var bb = lx.b, p = lx.p, n = bb.length;
          while (p < n - 1 && !(bb[p] === 73 && bb[p + 1] === 68 && isWS(bb[p + 2] === undefined ? 32 : bb[p + 2]) && isWS(bb[p - 1]))) p++;
          p += 3;
          while (p < n - 1 && !(bb[p] === 69 && bb[p + 1] === 73 && isWS(bb[p - 1]) && (p + 2 >= n || isWS(bb[p + 2]) || isDelim(bb[p + 2])))) p++;
          lx.p = p + 2;
          break;
        }
        case 'Do': {
          var xo = xobjs && a[0] instanceof Name ? self.get(xobjs.m[a[0].n]) : null;
          if (xo instanceof Dict && self.name(xo.m.Subtype) === 'Form' && depth < 8) {
            var fm = self.get(xo.m.Matrix), mtx = Array.isArray(fm) && fm.length === 6 ? fm.map(function (x) { return self.get(x); }) : [1, 0, 0, 1, 0, 0];
            self.run(self.stream(xo), self.dict(xo.m.Resources) || res, mul(mtx, ctm), items, depth + 1);
          }
          break;
        }
      }
    }
  };
  function read(buf) {
    var doc = new Doc(buf), pages = doc.pages();
    if (!pages.length) throw new Error('PDF senza pagine');
    return pages.map(function (pg) {
      var c = doc.get(pg.d.m.Contents), list = Array.isArray(c) ? c : [c], parts = [], total = 0;
      list.forEach(function (x) { var d = doc.stream(x); parts.push(d); total += d.length + 1; });
      var all = new Uint8Array(total), at = 0;
      parts.forEach(function (d) { all.set(d, at); at += d.length; all[at++] = 10; });
      var items = [];
      doc.run(all, pg.res, [1, 0, 0, 1, 0, 0], items, 0);
      return items;
    });
  }

  var api = { read: read, inflate: inflate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PDFText = api;
})(this);
