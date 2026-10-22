/* Skreen guide: everything you need, without leaving the app. */
window.Guide = (() => {
  const sections = [
    {
      id: 'start', title: 'Start here',
      html: `
<h1>Welcome to Skreen</h1>
<p class="lede">A wall display for the things you glance at all day: the time, the weather, what's on the calendar and what's on the list.</p>
<h2>Getting started</h2>
<ol>
  <li><b>Install the Android app</b> on your tablet. <button class="btn ghost small" data-go="device">How →</button></li>
  <li><b>Sign in with Google.</b> Tap the button, choose your account and allow access. That's all there is to it. <button class="btn ghost small" data-go="signin">What you're allowing →</button></li>
  <li><b>Pick your city</b> in Settings for the weather, and choose which calendars to show.</li>
</ol>
<p>Until you sign in, you're looking at <b>sample data</b>.</p>
<div class="note">Weather works straight away with no account. You only need to pick your location in Settings.</div>`
    },
    {
      id: 'signin', title: 'Sign in with Google',
      html: `
<h1>Sign in with Google</h1>
<p class="lede">One tap, no setup, nothing to copy and paste.</p>
<ol>
  <li>In the Skreen app, tap <b>Sign in with Google</b> (on the welcome screen, or in Settings).</li>
  <li>Choose the Google account whose calendar and to-do list you want on the wall.</li>
  <li>Google shows what Skreen is asking for. Tap <b>Allow</b>.</li>
  <li>Open <b>Settings</b> (the small button in the bottom-left corner). Tick the calendars to show and choose a to-do list.</li>
</ol>
<h2>What you're allowing</h2>
<ul>
  <li><b>Read your calendars.</b> To show your schedule. Skreen can't change or delete events.</li>
  <li><b>Manage your tasks.</b> To show your to-do list, add items, and check them off.</li>
</ul>
<p>Skreen talks directly to Google from your tablet. Your calendar and tasks aren't sent to us or stored anywhere else.</p>
<h2>Changing or removing access</h2>
<ul>
  <li><b>Switch account:</b> Settings → Sign out, then sign in again.</li>
  <li><b>Revoke completely:</b> in your Google Account, open <b>Security → Your connections to third-party apps and services</b> and remove Skreen.</li>
</ul>
`
    },
    {
      id: 'device', title: 'On the tablet',
      html: `
<h1>On the tablet</h1>
<p class="lede">Make it full-screen, always on, and back after a restart.</p>
<h2>The Skreen Android app</h2>
<p>A small app that holds this display. It's full-screen, keeps the screen awake, handles Google sign-in, and can <b>dim the screen itself</b> (the best burn-in protection). It loads your live Skreen site, so changes to the site show up on the tablet by themselves, and it keeps working through Wi-Fi drops.</p>
<ol>
  <li>On the tablet, open the download in Chrome:<br><a class="btn primary" data-apk href="#" target="_blank" rel="noopener">Download Skreen.apk</a></li>
  <li>Open the downloaded file. Android asks to allow <b>installing unknown apps</b> from Chrome. Allow it, then tap <b>Install</b>.</li>
  <li>Open <b>Skreen</b> and sign in with Google.</li>
  <li><i>Optional:</i> press the Home button and choose <b>Skreen → Always</b>. Skreen becomes the tablet's Home screen, so it opens at boot and Home always returns to it.</li>
</ol>
<div class="note">Most changes reach the tablet by themselves, because the app loads your Skreen site. When the app itself has a new version, Skreen tells you: an <b>Install update</b> notice appears at the bottom of the screen (you can also check under <b>Settings → App</b>). Tap it and Android asks you to confirm; the first time, it also asks you to allow Skreen to install apps. Your settings stay through updates. If the tablet can't reach the site at all (for example, the very first launch while offline), the app shows a built-in copy with sample data and switches to the real thing as soon as it's online.</div>
`
    },
    {
      id: 'look', title: 'Backgrounds',
      html: `
<h1>Backgrounds</h1>
<p class="lede">Soft, dark colour fields that change every day, so the wall never feels stale and the text stays easy to read.</p>
<p>Skreen rotates through these, one per day. To pin one, go to <b>Settings → Background</b>. You can also change the <b>Typeface</b> there: five options, from the default through an editorial serif to a tall poster face, previewed live behind the settings sheet.</p>
<p>Under <b>Settings → Layout</b> you can hide things you don't need (say, the schedule, to give the to-do list the room) and move them around with the arrows. The big-screen tour skips anything you've hidden.</p>
<div class="swatches" id="swatches"></div>`
    },
    {
      id: 'todo', title: 'The to-do list',
      html: `
<h1>The to-do list</h1>
<p class="lede">Tap to check off. Add from the wall or from your phone.</p>
<ul>
  <li><b>It's a Google Tasks list.</b> Choose which one in Settings. A list called "Household" is picked automatically if you have one. Google Keep has no connection for apps like this one, so Tasks is the closest match.</li>
  <li><b>Add from the wall</b> with the big <b>Add to list</b> button. Tap the microphone to dictate, or separate items with commas: <code>eggs, milk, bread</code>.</li>
  <li><b>Add from your phone</b> in the Google Tasks app, or from the Tasks panel beside Gmail, Calendar and Docs. Items appear on the wall within two minutes.</li>
  <li><b>Tap the check box to check an item off. Tap anywhere else on it</b> to open its details: change who it's for, read its notes, or mark it done.</li>
  <li><b>Who is it for?</b> When you add an item on the wall, tap a name under <b>Who?</b> (or <b>+ Someone</b> to add a new one). Leave it on <b>Anyone</b> for a shared job. The names show as colored tags beside the item. Skreen doesn't keep a list of people: the names offered are simply whoever is on a task right now (open, or finished in the last day), so a name disappears once nothing uses it. Behind the scenes, Skreen writes <code>@Dan</code> on the first line of the task's <b>Details</b> in Google Tasks, so you can also assign a task from your phone: open it in Google Tasks and put <code>@Dan @Mia</code> on the first line of Details. Anything you write below that line is left alone.</li>
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
  <li><b>Night mode.</b> From <span data-night>10:30 PM to 6:00 AM</span> (set under Settings → Screen care) the screen goes black with a dim clock that wanders slowly. On OLED, black pixels are off. Tap to wake the full display for two minutes.</li>
  <li><b>Moving backgrounds.</b> The background colours drift slowly, and change daily.</li>
</ul>
<h2>If you see a faint ghost image</h2>
<p>A faint outline of something that used to be on the screen (a home screen, an old app) is usually <b>temporary image retention</b>. Showing the screen varied content clears it, and Skreen's tour and night mode help. For a stubborn one, open <b>Settings → Screen care → Refresh screen</b>: it washes the whole screen slowly through white, black, red, green and blue for five minutes. Tap anywhere to stop. On an OLED panel, long-standing ghosts can be permanent burn-in, which no software can undo.</p>
<h2>What you can do</h2>
<ul>
  <li><b>Lower the brightness.</b> This is the single biggest help, and a wall display doesn't need to be bright. In the Android app, set it under Settings → Brightness (daytime and night levels). </li>
  <li>Use the tablet's <b>adaptive brightness</b> so it dims at night.</li>
  <li>Keep the tablet cool and out of direct sun.</li>
</ul>`
    },
    {
      id: 'fix', title: 'Troubleshooting',
      html: `
<h1>Troubleshooting</h1>
<h2>"Google needs you to sign in again"</h2>
<p>Google occasionally asks for permission again, for example after you change your Google password or remove Skreen from your account's connections. Tap the message and sign in; nothing is lost.</p>
<h2>"Can't reach Google right now"</h2>
<p>The tablet is offline, or Google is having a moment. Skreen keeps showing what it last had and retries every two minutes.</p>
<h2>A calendar is missing or one is cluttering the list</h2>
<p>In Settings, tick exactly the calendars you want under <b>Calendars to show</b>.</p>
<h2>The to-do list is empty or the wrong one</h2>
<p>Choose the list under <b>To-do list</b> in Settings.</p>
<h2>The screen looks wrong or stale</h2>
<p>Skreen checks for a newer version of itself every half hour and reloads once nobody is using it (no pop-up open, nothing touched for two minutes). It also reloads at 3:30 AM every night. To force it right now, close and reopen the app.</p>`
    },
  ];
  return { sections };
})();
