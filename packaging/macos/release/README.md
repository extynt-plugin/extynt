# extynt release packaging (macOS)

One command on the release Mac builds the package end users download: a signed,
notarized, stapled `extynt-<version>.pkg` that installs the native plugin
(`extyntcore.plugin`) into After Effects, the host library in
`/Library/Application Support/extynt/host`, and the sidecar, its login service and the served UI
for the signed-in user.

```sh
export AE_SDK_ROOT=~/SDKs/AdobeAfterEffectsSDK_26.5_MacOS
packaging/macos/release/make-release.sh                  # build, sign, notarize, staple
packaging/macos/release/make-release.sh --no-notarize    # same, without Apple's round trip (local installs)
packaging/macos/release/make-release.sh --dry-run        # print the plan and the resolved identities; builds nothing
```

`make-release.sh` needs your own signing identities (Developer ID Application and Developer ID Installer) in the keychain,
even with `--no-notarize`; only `--dry-run` runs without them. Without identities, build and install unsigned with
`native/extynt-core/build-mac.sh --install --no-sign` and `packaging/macos/install.sh`.

Output in `release-out/`: `extynt-<version>.pkg` and its `.sha256` (an Intel-only or Apple-silicon-only
package, `EXTYNT_ARCH=x64|arm64`, gets that suffix). The default package is universal.

| File | What |
| --- | --- |
| `make-release.sh` (Mac only) | builds the release bundle and the signed plugin, then the package, and signs, notarizes and staples it |
| `scripts/preinstall` | runs as root first: refuses when nobody is signed in at the console or no After Effects 2025/2026 is installed |
| `scripts/postinstall` | runs as root after the payload lands: runs `install.sh --system-only` as root, then `install.sh --user-only` as the console user in that user's login session; logs to `~/Library/Application Support/extynt/installer.log` |
| `distribution.xml` | installer configuration: system domain only, minimum macOS, an After Effects check |
| `text/<lang>.lproj/welcome.html`, `conclusion.html` | installer text in en, es, de, fr, ja and zh-Hans (Installer picks the user's language; `en.lproj` is also copied to the root as the fallback). Installer shows HTML as styled text, not a web page: keep them short (no scrolling) and leave the text colour to Installer so they read in light and dark |
| `branding/` | the window background (`background.png`, `background-dark.png`, 144 dpi) rendered from `background.html`: extynt.com's paper and ink, the tagline, the wordmark, and an ink frame and hard shadow under Installer's page box |
| `catalogue-window/` | the "Learning your effects" page: `CatalogueWindow.m` talks to the sidecar; `CatalogueView.m` lays the page out on `CatalogueTheme.m`, `CatalogueWords.m`, `CatalogueBar.m` and `CatalogueReceipt.m`. `preview.sh` shows it without installing (screenshots, a live window, `--pkg` probe packages) |

## What the script does

1. Resolves the two signing identities (below) and, unless `--no-notarize`, checks the notary profile.
2. Builds the bundle with `scripts/build-mac-bundle.sh`: the gate, then a rebuild of the sidecar. The bundle carries the
   pinned Node.js (`packaging/macos/node-runtime.env`), which `install-sidecar.sh` verifies and unpacks per user.
3. Builds `extyntcore.plugin` with `native/extynt-core/build-mac.sh` (universal, Developer ID Application,
   hardened runtime, secure timestamp) and verifies the signature again after it is staged.
4. Builds extynt Catalogue.app (`catalogue-window/`, universal, signed like the plugin) into the bundle; postinstall
   opens it as the user to run the first effect catalogue (ADR 0043).
5. Wraps the bundle in a system-domain package with `pkgbuild` and `productbuild` (no check script, no plugin, so
   Installer shows no "will run a program" warning), signs it with
   `productsign` (Developer ID Installer), submits it with `xcrun notarytool submit --keychain-profile
   extynt-notary --wait`, requires `status: Accepted`, then runs `xcrun stapler staple`, `stapler validate`
   and `spctl --assess --type install`.

## Installing and removing

The package asks for one administrator password. As root it copies the host library (root:wheel, no group or world write) and puts the signed plugin in
`/Applications/Adobe After Effects 2025|2026/Plug-ins/extynt/`. As the console user it installs the sidecar,
runtime, launcher, login service and served UI. The payload stays in
`/Library/Application Support/extynt/installer/<version>/` (only the newest is kept) and
`/Library/Application Support/extynt/uninstall.sh` links to its `uninstall.sh`, which removes everything the
package installed and forgets the receipt. Chats and settings in `~/Library/Application Support/extynt` are kept.

## Environment

| Variable | Meaning |
| --- | --- |
| `AE_SDK_ROOT` | the unpacked After Effects SDK; required to build the plugin |
| `EXTYNT_SIGN_APP` | `Developer ID Application: ...` identity. Unset: the single such identity in the keychain |
| `EXTYNT_SIGN_INSTALLER` | `Developer ID Installer: ...` identity. Unset: the single such identity in the keychain |
| `EXTYNT_NOTARY_PROFILE` | notarytool keychain profile, default `extynt-notary` |
| `EXTYNT_ARCH` | `universal` (default), `arm64` or `x64` |
| `EXTYNT_RELEASE_OUT` | output directory, default `./release-out` |
| `EXTYNT_SKIP_CHECK=1` | skip the gate inside the bundle script (use only right after a green `pnpm check`) |
| `EXTYNT_ALLOW_DIRTY=1` | allow uncommitted changes to tracked files |

With two matching identities in the keychain the script stops and asks for the variable.

## One-time setup on the release Mac

1. A paid Apple Developer Program membership with a **Developer ID Application** and a
   **Developer ID Installer** certificate in the login keychain (Xcode, Settings, Accounts, Manage
   Certificates). `security find-identity -v -p basic` lists both.
2. An App Store Connect API key (Users and Access, Integrations, Team Keys, Developer role). Download the `.p8`
   once, note the Key ID and Issuer ID, then:

   ```sh
   xcrun notarytool store-credentials extynt-notary --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER-UUID
   ```

Never commit or paste the `.p8`, a `.p12`, or their passwords.

## Checking a finished package

```sh
pkgutil --check-signature release-out/extynt-<version>.pkg
spctl --assess --type install -vv release-out/extynt-<version>.pkg      # Accepted, Notarized Developer ID
xcrun stapler validate release-out/extynt-<version>.pkg
pkgutil --payload-files release-out/extynt-<version>.pkg
```

After installing, `/Library/Application Support/extynt/installer/<version>/verify.sh` checks the installation.
