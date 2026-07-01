function seoLastSundayUTC(year, monthIndex) {
    var d = new Date(Date.UTC(year, monthIndex + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
}

function seoBrusselsOffset(utcDate) {
    var year = utcDate.getUTCFullYear();
    var dstStart = seoLastSundayUTC(year, 2);
    dstStart.setUTCHours(1, 0, 0, 0);
    var dstEnd = seoLastSundayUTC(year, 9);
    dstEnd.setUTCHours(1, 0, 0, 0);
    return (utcDate >= dstStart && utcDate < dstEnd) ? "+02:00" : "+01:00";
}

function seoIsoDateTime(datum, tijd) {
    var offset = seoBrusselsOffset(new Date(datum + "T" + tijd + ":00Z"));
    return datum + "T" + tijd + ":00" + offset;
}

function seoBuildEventJsonLd(voorstelling, detailUrl) {
    return {
        "@context": "https://schema.org",
        "@type": "TheaterEvent",
        "name": voorstelling.titel,
        "startDate": seoIsoDateTime(voorstelling.datum, voorstelling.tijd),
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "eventStatus": "https://schema.org/EventScheduled",
        "location": {
            "@type": "Place",
            "name": voorstelling.locatie,
            "address": voorstelling.adres || (voorstelling.locatie + ", " + voorstelling.stad)
        },
        "performer": {
            "@type": "PerformingGroup",
            "name": "Commotie"
        },
        "description": (voorstelling.tekst || []).join(" "),
        "image": "https://commotie.art/images/groep2026.jpg",
        "url": detailUrl
    };
}

function seoShortDescription(voorstelling, maxLen) {
    var tekst = (voorstelling.tekst || []).join(" ");
    if (tekst.length <= maxLen) {
        return tekst;
    }
    return tekst.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
}

function seoInjectJsonLd(data) {
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
}

function seoSetMeta(attr, key, content) {
    var selector = "meta[" + attr + "='" + key + "']";
    var el = document.querySelector(selector);
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

function seoSetCanonical(href) {
    var el = document.querySelector("link[rel='canonical']");
    if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        document.head.appendChild(el);
    }
    el.setAttribute("href", href);
}
