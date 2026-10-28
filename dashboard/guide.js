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
  <li><b>Sign in with Google.</b> Tap the button, choose your account and allow access. That's all there is to it. <button class="btn ghost small" data-go="signin">What you're allowing →</button></li>
  <li><b>Pick your city</b> in Settings for the weather, and choose which calendars and which to-do list to show.</li>
  <li><b>Optional:</b> add Outlook, Apple or other calendars with a link. <button class="btn ghost small" data-go="calendars">How →</button></li>
  <li><b>Optional:</b> make the tablet a proper wall display. <button class="btn ghost small" data-go="device">Tips →</button></li>
</ol>
<p>Until you sign in or add a calendar link, you're looking at <b>sample data</b>.</p>
<div class="note">Weather works straight away with no account. You only need to pick your location in Settings.</div>`
    },
    {
      id: 'signin', title: 'Sign in with Google',
      html: `
<h1>Sign in with Google</h1>
<p class="lede">One tap, no setup, nothing to copy and paste.</p>
<ol>
  <li>In the Skreen app, tap <b>Sign in with Google</b> (on the welcome skreen, or in Settings).</li>
  <li>Choose the Google account whose calendar and to-do list you want on the wall.</li>
  <li>Google shows what Skreen is asking for. Tap <b>Allow</b>.</li>
  <li>Open <b>Settings</b> (the small button in the bottom-left corner). Tick the calendars to show and choose a to-do list.</li>
</ol>
<h2>What you're allowing</h2>
<ul>
  <li><b>Read your calendars.</b> To show your schedule. Skreen can't change or delete events.</li>
  <li><b>Manage your tasks.</b> To show your to-do list, add items, and check them off.</li>
</ul>
<p>Skreen talks directly to Google from your tablet. Your Google calendar and tasks aren't sent to us or stored anywhere else.</p>
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
<ul>
  <li><b>Full screen and awake.</b> Skreen fills the screen and keeps it on while the app is open. Leave the tablet plugged in.</li>
  <li><b>Make it the Home screen.</b> <i>Optional.</i> Press the Home button and choose <b>Skreen → Always</b>. Skreen then opens when the tablet starts, and Home always returns to it.</li>
  <li><b>Brightness.</b> A wall display doesn't need to be bright. Settings → Brightness sets a daytime and a night level for this app only.</li>
  <li><b>Updates.</b> Google Play keeps the app up to date. The skreens inside the app update themselves, usually overnight.</li>
  <li><b>Mounting.</b> Any tablet works, in either direction. Wall mounts and stands that keep the charger connected are easy to find.</li>
</ul>`
    },
    {
      id: 'calendars', title: 'Other calendars',
      html: `
<h1>Other calendars</h1>
<p class="lede">Outlook, Apple, Yahoo and most other calendars can show up on Skreen with a link, free, with no extra sign-in.</p>
<p>Each of these services can <b>publish</b> a calendar as a private web link. Copy that link, then paste it into <b>Settings → Other calendars</b> and tap <b>Add calendar</b>.</p>
<h2>Where to find the link</h2>
<ul>
  <li><b>Outlook.com / Microsoft 365:</b> on the web, open <b>Settings → Calendar → Shared calendars</b>. Under <b>Publish a calendar</b>, choose the calendar and <b>Can view all details</b>, click <b>Publish</b>, then copy the <b>ICS</b> link. (Some work and school accounts don't allow publishing.)</li>
  <li><b>Apple iCloud:</b> on icloud.com, open Calendar, click the share icon next to a calendar, tick <b>Public Calendar</b> and copy the link. It starts with <code>webcal://</code>, which Skreen accepts.</li>
  <li><b>Yahoo, Fastmail and others:</b> look for <b>share</b>, <b>subscribe</b> or <b>export as iCal</b> and copy the link that ends in <code>.ics</code>.</li>
  <li><b>Google Calendar:</b> you don't need a link. Sign in with Google instead.</li>
</ul>
<h2>Good to know</h2>
<ul>
  <li><b>Treat the link like a password.</b> Anyone who has it can read that calendar. You can unpublish it from the service at any time.</li>
  <li>Skreen's relay fetches the link for you because browsers can't read most calendar hosts directly. It keeps the calendar for about five minutes so a busy moment doesn't hammer your provider, and stores nothing else.</li>
  <li>Changes can take a few minutes to appear, and some services refresh their published links only every few hours.</li>
  <li>Links are stored on this tablet only. Skreen can't add or change events on these calendars.</li>
</ul>`
    },
    {
      id: 'plus', title: 'Skreen+',
      html: `
<h1>Skreen+</h1>
<p class="lede">Everything you see on the main skreen is free, for good. Skreen+ is a single one-time purchase that adds extras.</p>
<h2>What it adds</h2>
<ul>
  <li><b>Several Google accounts</b>, and several calendars and to-do lists from each, shown together.</li>
  <li><b>Your own layout.</b> Show or hide the clock, weather, schedule and to-do list, and put them in any order.</li>
  <li><b>Photos.</b> A slideshow on the main skreen and in the rotating tour: either a gallery of paintings (no setup), or your own pictures chosen from Google Photos or the tablet.</li>
  <li><b>Dinner planner.</b> What's for dinner each day this week, kept in a Google Tasks list. Add it under Settings → Layout. <button class="btn ghost small" data-go="dinners">How it works →</button></li>
  <li><b>Shopping list.</b> A Google Tasks list on the wall: tap an item to tick it off, or tap <b>Add item</b> (type or speak). Make a list in Google Tasks called <b>Shopping</b>, choose it under Settings → Shopping list, then tick <b>Shopping list</b> under Settings → Layout. Family members can add to it from their phones.</li>
  <li><b>In the news.</b> A short list of today's top stories from Wikipedia's front page, as a widget and in the rotating tour. Add it under Settings → Layout.</li>
  <li><b>Big Skreen Mode.</b> A different way to use Skreen, like a smart display: one big slide at a time, rotating through every widget you've turned on (a minute each), with a Music slide while something plays. The time, the weather, your timers and a music player with its controls stay in view on every slide. Turn it on under <b>Settings → Big Skreen Mode</b>, where you also choose how long each slide stays and which slides to leave out. Tap the skreen to pause it for two minutes.</li>
</ul>
<h2>Buying and restoring</h2>
<p>Open <b>Settings → Skreen+</b> and tap <b>Unlock Skreen+</b>. You pay once through Google Play, and it's yours for good. Installed Skreen on another tablet signed in to the same Google Play account? Open Settings there and it unlocks by itself.</p>
<div class="note">For your own pictures, open <b>Settings → Photos</b>, choose <b>My photos</b> and tap <b>Choose photos</b>. Android's photo picker opens (it includes Google Photos). Skreen keeps a smaller copy on the tablet only, so to change them just choose again.</div>`
    },
    {
      id: 'timers', title: 'Timers',
      html: `
<h1>Timers</h1>
<p class="lede">Free, and always there: tap the stopwatch button in the bottom-left corner.</p>
<ul>
  <li><b>Set a time</b> with the presets (1, 5, 10, 15, 30 minutes, 1 hour) or the number pad. Type 1, 0, 0, 0 for ten minutes, like a microwave. Give it a name if you like, such as <i>Pasta</i>.</li>
  <li><b>Say it.</b> Tap the microphone and say, for example, <i>"ten minutes"</i> or <i>"an hour and a half"</i>.</li>
  <li><b>Run up to four at once.</b> They show as big countdowns across the top of the skreen, also during the rotating tour and at night. Tap one to add a minute or cancel it.</li>
  <li><b>When one finishes</b> the whole skreen turns orange and the tablet plays its alarm tone until you tap <b>Stop</b> (or <b>+5 more minutes</b>). The sound uses the tablet's <i>alarm</i> volume, so turn that up in the tablet's sound settings.</li>
  <li>Timers carry on if Skreen restarts or reloads itself.</li>
</ul>`
    },
    {
      id: 'dinners', title: 'Dinner planner',
      html: `
<h1>Dinner planner</h1>
<p class="lede">Skreen+: the week's dinners on the wall, kept in a Google Tasks list so you can also plan from your phone.</p>
<ol>
  <li>In the <b>Google Tasks</b> app (or the Tasks panel beside Gmail), make a new list called <b>Dinners</b>.</li>
  <li>In Skreen, open <b>Settings → Dinners</b> and choose that list, then <b>Settings → Layout</b> and tick <b>Dinners</b>.</li>
  <li><b>Plan from the wall:</b> tap a day, type or say the meal, and Save. Tap again to change it or Clear it.</li>
  <li><b>Plan from your phone:</b> add a task to the Dinners list and give it a <b>date</b>. The task name is the meal and the date is the day it's for.</li>
</ol>
<div class="note">Keep Dinners separate from your everyday to-do list. Each dinner is a task with a date, so if you also show that list as your to-do list the dinners would appear there too.</div>`
    },
    {
      id: 'look', title: 'Backgrounds',
      html: `
<h1>Backgrounds</h1>
<p class="lede">Soft, dark color fields that change every day, so the wall never feels stale and the text stays easy to read.</p>
<p>Skreen rotates through these, one per day. To pin one, go to <b>Settings → Display</b>. You can also change the <b>Typeface</b> there: five options, from the default through an editorial serif to a tall poster face. Pick an <b>Accent color</b> too, to swap the orange highlight for amber, mint, sky, blue, violet, rose or red, or choose <b>Surprise me</b> to get a new one every day, on the same schedule as the backgrounds. Both preview live behind the settings sheet.</p>
<p>Under <b>Settings → Layout</b> you can hide things you don't need (say, the schedule, to give the to-do list the room) and move them around with the arrows. The rotating tour skips anything you've hidden.</p>
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
      id: 'care', title: 'Skreen care',
      html: `
<h1>Skreen care</h1>
<p class="lede">Will an always-on skreen burn in? It depends on the panel.</p>
<h2>The honest answer</h2>
<ul>
  <li><b>OLED/AMOLED tablets</b> (such as the Samsung Galaxy Tab S series) <i>can</i> permanently burn in after months of the same bright shapes in the same place.</li>
  <li><b>LCD tablets</b> (most others: Galaxy Tab A, Lenovo, Fire, Pixel Tablet) don't permanently burn in, but can show faint ghosting for a while after a static image.</li>
</ul>
<p>Not sure which you have? Search your model name plus "OLED or LCD".</p>
<h2>What Skreen does about it</h2>
<ul>
  <li><b>Rotating tour.</b> Every few minutes it takes over for about 30 seconds and shows the time, then the weather, the calendar and the to-do list, each as one huge page, and alternates left, centre and right. Nothing sits in the same pixels for long. Change the interval in Settings, or turn it off. Tap the skreen to end a tour early.</li>
  <li><b>Gentle layout nudge.</b> The whole layout drifts a few pixels over the day.</li>
  <li><b>Night mode.</b> From <span data-night>10:30 PM to 6:00 AM</span> (set under Settings → Skreen care) the skreen goes black with a dim clock that wanders slowly. On OLED, black pixels are off. Tap to wake the full display for two minutes.</li>
  <li><b>Moving backgrounds.</b> The background colors drift slowly, and change daily.</li>
</ul>
<h2>If you see a faint ghost image</h2>
<p>A faint outline of something that used to be on the skreen (a home screen, an old app) is usually <b>temporary image retention</b>. Showing the skreen varied content clears it, and Skreen's tour and night mode help. On an OLED panel, long-standing ghosts can be permanent burn-in, which no software can undo.</p>
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
<h2>The skreen looks wrong or stale</h2>
<p>Skreen checks for a newer version of itself every half hour and reloads once nobody is using it (no pop-up open, nothing touched for two minutes). It also reloads at 3:30 AM every night. To force it right now, close and reopen the app.</p>`
    },
  ];
  return { sections };
})();
