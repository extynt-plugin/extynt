/* A global JSON for a script engine that has none, loaded by the library guard while JSON is missing so every entry
 * can parse its arguments. An existing JSON is never replaced.
 */
(function () {
    if (typeof JSON === "object") return;
    var ESCAPES = { "\"": "\\\"", "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
    var NEEDS_ESCAPE = /[\\"\u0000-\u001f\u2028\u2029]/;
    var LITERALS = { "true": true, "false": false, "null": null };
    var NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
    var NUMBER_CHARS = "-+0123456789.eE";
    var WHITESPACE = " \t\n\r";

    function isArray(value) { return Object.prototype.toString.call(value) === "[object Array]"; }
    function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function hex4(code) { return ("0000" + code.toString(16)).slice(-4); }

    function escapeChar(ch) {
        if (hasOwn(ESCAPES, ch)) return ESCAPES[ch];
        var code = ch.charCodeAt(0);
        return (code < 0x20 || code === 0x2028 || code === 0x2029) ? "\\u" + hex4(code) : null;
    }

    function quote(text) {
        if (!NEEDS_ESCAPE.test(text)) return "\"" + text + "\"";
        var parts = [], start = 0;
        for (var i = 0; i < text.length; i += 1) {
            var escaped = escapeChar(text.charAt(i));
            if (escaped !== null) { parts.push(text.slice(start, i), escaped); start = i + 1; }
        }
        parts.push(text.slice(start));
        return "\"" + parts.join("") + "\"";
    }

    function makeWriter(replacer, space) {
        var indent = typeof space === "number" ? new Array(Math.max(0, Math.min(10,
          Math.floor(space))) + 1).join(" ") : (typeof space === "string" ? space.slice(0, 10) : "");
        var keys = isArray(replacer) ? replacer : null;
        return { replacer: typeof replacer === "function" ? replacer : null, keys: keys, indent: indent, stack: [] };
    }

    function prepared(writer, holder, key) {
        var value = holder[key];
        if (value !== null && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON(key);
        if (writer.replacer) value = writer.replacer.call(holder, key, value);
        return value;
    }

    function enter(writer, value) {
        for (var i = 0; i < writer.stack.length; i += 1) if (writer.stack[i] === value) throw new TypeError("JSON.stringify: cyclic structure");
        writer.stack.push(value);
    }

    function wrap(writer, brackets, items, gap) {
        var open = brackets.charAt(0), close = brackets.charAt(1);
        if (items.length === 0) return brackets;
        if (!writer.indent) return open + items.join(",") + close;
        var inner = gap + writer.indent;
        return open + "\n" + inner + items.join(",\n" + inner) + "\n" + gap + close;
    }

    function writeArray(writer, value, gap) {
        var items = [];
        for (var i = 0; i < value.length; i += 1) {
            var item = writeValue(writer, value, String(i), gap + writer.indent);
            items.push(item === undefined ? "null" : item);
        }
        return wrap(writer, "[]", items, gap);
    }

    function objectKeys(writer, value) {
        if (writer.keys) return writer.keys;
        var keys = [];
        for (var key in value) if (hasOwn(value, key)) keys.push(key);
        return keys;
    }

    function writeObject(writer, value, gap) {
        var keys = objectKeys(writer, value), items = [], colon = writer.indent ? ": " : ":";
        for (var i = 0; i < keys.length; i += 1) {
            var item = writeValue(writer, value, String(keys[i]), gap + writer.indent);
            if (item !== undefined) items.push(quote(String(keys[i])) + colon + item);
        }
        return wrap(writer, "{}", items, gap);
    }

    function writeComposite(writer, value, gap) {
        enter(writer, value);
        var text = isArray(value) ? writeArray(writer, value, gap) : writeObject(writer, value, gap);
        writer.stack.pop();
        return text;
    }

    function unboxed(value) { return (value instanceof Number || value instanceof String || value instanceof Boolean) ? value.valueOf() : value; }

    function writeValue(writer, holder, key, gap) {
        var value = unboxed(prepared(writer, holder, key));
        switch (typeof value) {
            case "string": return quote(value);
            case "number": return isFinite(value) ? String(value) : "null";
            case "boolean": return String(value);
            case "object": return value === null ? "null" : writeComposite(writer, value, gap);
            default: return undefined;
        }
    }

    function stringify(value, replacer, space) {
        return writeValue(makeWriter(replacer, space), { "": value }, "", "");
    }

    function fail(source, what) { throw new SyntaxError("JSON.parse: " + what + " at offset " + source.at); }

    function skipSpace(source) {
        while (source.at < source.text.length && WHITESPACE.indexOf(source.text.charAt(source.at)) >= 0) source.at += 1;
    }

    function expect(source, ch) {
        if (source.text.charAt(source.at) !== ch) fail(source, "expected '" + ch + "'");
        source.at += 1;
    }

    function readEscape(source) {
        var ch = source.text.charAt(source.at);
        source.at += 1;
        if (ch === "u") {
            var digits = source.text.substr(source.at, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail(source, "bad unicode escape");
            source.at += 4;
            return String.fromCharCode(parseInt(digits, 16));
        }
        var simple = { "\"": "\"", "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t" };
        if (!hasOwn(simple, ch)) fail(source, "bad escape");
        return simple[ch];
    }

    function readString(source) {
        var text = source.text, parts = [];
        source.at += 1;
        var start = source.at;
        for (;;) {
            if (source.at >= text.length) fail(source, "unterminated string");
            var ch = text.charAt(source.at);
            if (ch === "\"") break;
            if (ch.charCodeAt(0) < 0x20) fail(source, "control character in string");
            if (ch === "\\") { parts.push(text.slice(start, source.at)); source.at += 1; parts.push(readEscape(source)); start = source.at;
              } else source.at += 1;
        }
        parts.push(text.slice(start, source.at));
        source.at += 1;
        return parts.join("");
    }

    function readNumber(source) {
        var start = source.at;
        while (source.at < source.text.length && NUMBER_CHARS.indexOf(source.text.charAt(source.at)) >= 0) source.at += 1;
        var token = source.text.slice(start, source.at);
        if (!NUMBER.test(token)) { source.at = start; fail(source, "bad number"); }
        return Number(token);
    }

    function readLiteral(source) {
        for (var word in LITERALS) {
            if (hasOwn(LITERALS, word) && source.text.substr(source.at, word.length) === word) { source.at += word.length; return LITERALS[word]; }
        }
        return fail(source, "unexpected character");
    }

    function readArray(source) {
        var items = [];
        source.at += 1;
        skipSpace(source);
        if (source.text.charAt(source.at) === "]") { source.at += 1; return items; }
        for (;;) {
            items.push(readValue(source));
            skipSpace(source);
            if (source.text.charAt(source.at) === "]") { source.at += 1; return items; }
            expect(source, ",");
        }
    }

    function readMember(source, object) {
        skipSpace(source);
        if (source.text.charAt(source.at) !== "\"") fail(source, "expected a key");
        var key = readString(source);
        skipSpace(source);
        expect(source, ":");
        object[key] = readValue(source);
        skipSpace(source);
    }

    function readObject(source) {
        var object = {};
        source.at += 1;
        skipSpace(source);
        if (source.text.charAt(source.at) === "}") { source.at += 1; return object; }
        for (;;) {
            readMember(source, object);
            if (source.text.charAt(source.at) === "}") { source.at += 1; return object; }
            expect(source, ",");
        }
    }

    function readValue(source) {
        skipSpace(source);
        var ch = source.text.charAt(source.at);
        if (ch === "{") return readObject(source);
        if (ch === "[") return readArray(source);
        if (ch === "\"") return readString(source);
        if (ch === "-" || (ch >= "0" && ch <= "9")) return readNumber(source);
        return readLiteral(source);
    }

    function revive(holder, key, reviver) {
        var value = holder[key];
        if (value !== null && typeof value === "object") {
            for (var name in value) {
                if (!hasOwn(value, name)) continue;
                var revived = revive(value, name, reviver);
                if (revived === undefined) delete value[name]; else value[name] = revived;
            }
        }
        return reviver.call(holder, key, value);
    }

    function parse(text, reviver) {
        var source = { text: String(text), at: 0 };
        var value = readValue(source);
        skipSpace(source);
        if (source.at < source.text.length) fail(source, "unexpected text after the value");
        return typeof reviver === "function" ? revive({ "": value }, "", reviver) : value;
    }

    $.global.JSON = { parse: parse, stringify: stringify };
})();
