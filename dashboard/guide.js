/* Skreen setup guide: everything you need, without leaving the app. */
window.Guide = (() => {
  const sections = [
    {
      id: 'start', title: 'Start here',
      html: `
<h1>Welcome to Skreen</h1>
<p class="lede">A wall display for the things you glance at all day: the time, the weather, what's on the calendar and what's on the list.</p>
<h2>How it works</h2>
<p>Skreen has two parts. This page is the display. A small <b>script that lives in your own Google account</b> hands it your calendar, your to-do list and, if you like, photos. Nothing passes through anyone else's server, and nothing on the tablet expires overnight.</p>
<p>Until you connect it, you're looking at <b>sample data</b>. Connecting takes about ten minutes and is mostly copy and paste.</p>
<p><button class="btn primary" data-go="connect">Connect Google →</button><button class="btn ghost" data-go="device">Put it on the tablet</button></p>
<div class="note">Weather works straight away with no account. You only need to pick your location in Settings.</div>`
    },
    {
      id: 'connect', title: 'Connect Google',
      html: `
<h1>Connect Google</h1>
<p class="lede">One-time setup. A computer is easier than the tablet for the first three steps.</p>
<ol>
  <li>Open <b>script.google.com</b>, sign in with the Google account that owns your calendar, and choose <b>New project</b>. Name it <code>Skreen</code>.</li>
  <li>Copy the script from here, delete everything in the editor, and paste.<br>
    <button class="btn primary small" data-copy-script>Copy the script</button> <span class="inline-status" data-copy-status></span></li>
  <li>Near the top, change <code>SECRET</code> to a long random phrase such as <code>purple-toaster-lighthouse-9271</code>. Remember it; you'll enter it in Skreen. To hide some calendars (holidays, sports), list their names in <code>EXCLUDE_CALENDAR_NAMES</code>.</li>
  <li>In the left sidebar next to <b>Services</b>, click <b>+</b>, choose <b>Google Tasks API</b>, then <b>Add</b>.</li>
  <li>In the toolbar, pick <code>testSetup</code> from the function menu and click <b>Run</b>. Google asks for permission. You'll see <i>"Google hasn't verified this app"</i>. That's expected, because you wrote it for yourself. Click <b>Advanced</b>, then <b>Go to Skreen (unsafe)</b>, then <b>Allow</b>. The log should list a few of your events and tasks.</li>
  <li>Click <b>Deploy → New deployment</b>, then the gear icon → <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>. Copy the <b>Web app URL</b>; it ends in <code>/exec</code>.</li>
  <li>In Skreen, tap the faint gear in the bottom-right corner and paste the URL and your secret. Tap <b>Test connection</b>; you should see <b>Connected</b>. Then <b>Save</b>.<br>
    <button class="btn ghost small" data-open-settings>Open settings</button></li>
</ol>
<div class="note">"Anyone" sounds scary, but the script only answers requests that include your secret phrase, and it can only reach what you granted in step 5. Pick a long secret and don't share the URL.</div>
<div class="note warn">Later changes to the script take effect only after <b>Deploy → Manage deployments → ✎ → Version: New version → Deploy</b>. The URL stays the same.</div>`
    },
    {
      id: 'device', title: 'On the tablet',
      html: `
<h1>On the tablet</h1>
<p class="lede">Make it full-screen, always on, and back after a restart.</p>
<h2>Best: Fully Kiosk Browser</h2>
<ol>
  <li>Install <b>Fully Kiosk Browser</b> from the Play Store. The free version is enough.</li>
  <li>Set the <b>Start URL</b> to this page's address.</li>
  <li>Turn on <b>Keep Screen On</b> and <b>Launch on Boot</b>. Optionally enable kiosk mode to lock the tablet to this page.</li>
</ol>
<h2>Or: Chrome only</h2>
<ol>
  <li>Open this page in Chrome, tap <b>⋮ → Add to Home screen</b>, and launch it from that icon for a full-screen view.</li>
  <li>Set the tablet's screen timeout to <b>Never</b> (or enable <i>Stay awake while charging</i> in Developer options).</li>
</ol>
<h2>Use another device</h2>
<p>Settings live on each device. Typing a long URL on a wall tablet is miserable, so make a link on a computer and send it to the tablet (email it to yourself, for instance). Opening it saves the settings and the secret disappears from the address bar.</p>
<div class="linkgen">
  <input id="lgUrl" placeholder="Backend URL (…/exec)" autocomplete="off">
  <input id="lgKey" placeholder="Secret key" autocomplete="off">
  <div class="out" id="lgOut">Fill in both boxes to build your link.</div>
  <div><button class="btn primary small" data-copy-link>Copy link</button></div>
</div>
<div class="note">Anyone with that link can see your calendar and list, so treat it like a password.</div>`
    },
    {
      id: 'look', title: 'Backgrounds & photos',
      html: `
<h1>Backgrounds & photos</h1>
<p class="lede">Calm, dark backgrounds that change every day, or your own photos.</p>
<h2>Built-in backgrounds</h2>
<p>Skreen rotates through these, one per day. To pin one, go to <b>Settings → Background</b>.</p>
<div class="swatches" id="swatches"></div>
<h2>Your own photos</h2>
<p>Photos appear as a slow, dimmed, softly blurred background, so the text stays easy to read even if the picture is busy.</p>
<ol>
  <li>In Google Drive, create a folder and put your photos in it.</li>
  <li>Open the folder. The ID is the last part of the address: <code>drive.google.com/drive/folders/<b>THIS-PART</b></code>.</li>
  <li>In your script, paste it between the quotes of <code>PHOTOS_FOLDER_ID</code>, run <code>testSetup</code> again (Google will ask for Drive permission), then deploy a <b>new version</b>.</li>
  <li>In Skreen: <b>Settings → Background → My photos</b>.</li>
</ol>
<div class="note"><b>About Google Photos:</b> since 2025 Google no longer lets apps browse your Photos library. Download an album and drop it in the Drive folder instead. New pictures show up within about an hour.</div>`
    },
    {
      id: 'todo', title: 'The to-do list',
      html: `
<h1>The to-do list</h1>
<p class="lede">Tap to check off. Add from the wall or from your phone.</p>
<ul>
  <li><b>It's a Google Tasks list called "Household".</b> Skreen creates it for you. Google Keep has no connection for apps like this one, so Tasks is the closest match.</li>
  <li><b>Add from the wall</b> with the big <b>Add to list</b> button. Tap the microphone to dictate, or separate items with commas: <code>eggs, milk, bread</code>.</li>
  <li><b>Add from your phone</b> in the Google Tasks app, or from the Tasks panel beside Gmail, Calendar and Docs. Choose the <i>Household</i> list. Items appear on the wall within two minutes.</li>
  <li><b>Checked-off items stay for 24 hours</b>, struck through at the bottom of the list, so you can see what got done. Tap one to bring it back. After a day it disappears.</li>
</ul>`
    },
    {
      id: 'care', title: 'Screen care',
      html: `
<h1>Screen care</h1>
<p class="lede">Will an always-on screen burn in? It depends on the panel.</p>
<h2>The honest answer</h2>
<ul>
  <li><b>OLED/AMOLED tablets</b> (such as the Samsung Galaxy Tab S series) <i>can</i> permanently burn in after months of the same bright shapes in the same place.</li>
  <li><b>LCD tablets</b> (most others: Galaxy Tab A, Lenovo, Fire, Pixel Tablet) don't permanently burn in, but can show faint ghosting for a while after a static image.</li>
</ul>
<p>Not sure which you have? Search your model name plus "OLED or LCD".</p>
<h2>What Skreen does about it</h2>
<ul>
  <li><b>Big-screen tour.</b> Every few minutes it takes over for about 30 seconds and shows the time, then the weather, the calendar and the to-do list, each as one huge page, and alternates left, centre and right. Nothing sits in the same pixels for long. Change the interval in Settings, or turn it off. Tap the screen to end a tour early.</li>
  <li><b>Gentle layout nudge.</b> The whole layout drifts a few pixels over the day.</li>
  <li><b>Night mode.</b> From 10:30 PM to 6 AM the screen goes black with a dim clock that wanders slowly. On OLED, black pixels are off. Tap to wake the full display for two minutes.</li>
  <li><b>Moving backgrounds.</b> Background art drifts, and changes daily.</li>
</ul>
<h2>What you can do</h2>
<ul>
  <li><b>Lower the tablet's brightness.</b> This is the single biggest help, and a wall display doesn't need to be bright. A web page can't control it, so set it in the tablet's settings.</li>
  <li>Use the tablet's <b>adaptive brightness</b> so it dims at night.</li>
  <li>Keep the tablet cool and out of direct sun.</li>
</ul>`
    },
    {
      id: 'fix', title: 'Troubleshooting',
      html: `
<h1>Troubleshooting</h1>
<h2>"Can't reach Google right now"</h2>
<p>The tablet is offline, or the script returned an error. On a computer, open your backend URL followed by <code>?action=dashboard&amp;key=YOUR_SECRET</code>. It will either show your data or say what's wrong.</p>
<h2>"Secret key doesn't match"</h2>
<p>The secret in Skreen must match <code>SECRET</code> in your script exactly. If you changed it, deploy a new version.</p>
<h2>I changed the script and nothing happened</h2>
<p>Deploy a <b>new version</b>: Deploy → Manage deployments → ✎ → Version: New version.</p>
<h2>A calendar is missing or one is cluttering the list</h2>
<p>By default Skreen shows every calendar that's ticked in Google Calendar's left sidebar. Hide some with <code>EXCLUDE_CALENDAR_NAMES</code>, or choose exactly which ones with <code>CALENDAR_IDS</code>.</p>
<h2>Checked-off items don't show</h2>
<p>Update your script to the latest version from this guide (<b>Connect Google → Copy the script</b>, keep your own <code>SECRET</code>) and deploy a new version.</p>
<h2>The screen looks wrong or stale</h2>
<p>Skreen reloads itself at 3:30 AM every night. To force it, pull down to refresh or reopen the page.</p>`
    },
  ];
  return { sections };
})();
