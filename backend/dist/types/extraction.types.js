"use strict";
/**
 * Type definitions of the extraction layer.
 *
 * The extraction layer is responsible for turning a raw TXT payload into a
 * normalized movie description, whatever the format of the file is.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceFormat = void 0;
/**
 * Format of the raw TXT payload.
 */
var SourceFormat;
(function (SourceFormat) {
    /** A plain JSON document (the output of the crawler). */
    SourceFormat["JSON_DOCUMENT"] = "JSON_DOCUMENT";
    /** A React Flight / Next.js Server Component payload. */
    SourceFormat["REACT_FLIGHT"] = "REACT_FLIGHT";
    /** A JSON document embedded inside HTML or plain text. */
    SourceFormat["EMBEDDED_JSON"] = "EMBEDDED_JSON";
    /** A raw HTML page that embeds the data in a script tag. */
    SourceFormat["HTML"] = "HTML";
    /** The format could not be determined. */
    SourceFormat["UNKNOWN"] = "UNKNOWN";
})(SourceFormat || (exports.SourceFormat = SourceFormat = {}));
//# sourceMappingURL=extraction.types.js.map