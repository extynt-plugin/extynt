# Capability catalogue

Versioned, bounded, graph-shaped catalogue contracts for known After Effects
capabilities and read-only host observations. Stable `matchName` values are
identity; display names and usage claims carry explicit provenance.

The host adapter currently supplies observed effect instances, not a complete
installation inventory. Enumeration state is therefore explicit.

The curated seed includes versioned Adobe-native profiles for transform, text,
masks, shape, footage, camera, light, and audio families, plus common blur,
glow, color-correction, sharpen, noise, distortion, stylize, keying, and
transition effects. Stable `matchName` values identify entries and exact
observed property paths identify controls; a known catalogue entry with no
matching observation remains `absent`, while an unknown entry is
`unavailable`.

Facts about plug-ins, fonts and verification results come only from collection
on the user's own computer; the package carries no third-party plug-in data and
no verification ledger. The ledger it reads is a local file written by
`extynt-host-verification`.
