// Reality Check: everything a match deals out. Cards, Babel events, tile events, backgrounds and traits.
// Ported from joshhickson/reality_check (src/cards/*.csv and cards/card_templates.json), with the numbers
// rebalanced so a choice is a real trade. Plain data, used by server.js, bot.js and the client alike.
//
// fx keys: money (dollars), mental (0-10), sin, virtue. A choice can also have:
//   cost: n         the choice needs at least $n in the bank
//   later: { in, fx, text }   fires at the start of your turn `in` turns from now
//   others: fx      applied to every other player
//   roll: [{ upTo, fx, text }]   a d6 decides the outcome (first entry with roll <= upTo)

export const RINGS = [
  { id: 'career', name: 'Career', color: '#d93a2b', cusps: 3, blurb: 'Money, burnout, temptation' },
  { id: 'health', name: 'Health', color: '#e8b923', cusps: 4, blurb: 'Your mind, your body, your copays' },
  { id: 'social', name: 'Social', color: '#1f9aa0', cusps: 5, blurb: 'Friends, family, drama' },
  { id: 'personal', name: 'Personal', color: '#2f8f4e', cusps: 6, blurb: 'Growth, hobbies, the soul' },
];

export const BABEL = { id: 'babel', name: 'Babel', color: '#7b4bc4' };

// What each of a ring's 10 tiles does. Tile 0 is the ring's anchor: pass or land on it for the lap bonus.
export const TILES = {
  career: ['anchor', 'sin', 'chaos', 'sin', 'bonus', 'sin', 'virtue', 'chaos', 'sin', 'bonus'],
  health: ['anchor', 'chaos', 'virtue', 'sin', 'chaos', 'bonus', 'sin', 'virtue', 'chaos', 'bonus'],
  social: ['anchor', 'virtue', 'sin', 'chaos', 'virtue', 'sin', 'bonus', 'virtue', 'sin', 'chaos'],
  personal: ['anchor', 'virtue', 'chaos', 'virtue', 'bonus', 'sin', 'virtue', 'chaos', 'virtue', 'bonus'],
};

export const LAP_BONUS = {
  career: { title: 'Payday', text: 'Direct deposit hits. For one beautiful hour you feel rich.', fx: { money: 2500 } },
  health: { title: 'Annual Checkup', text: 'Your doctor says you are "fine, probably." You choose to believe it.', fx: { mental: 1 } },
  social: { title: 'Birthday Party', text: 'Someone remembered your birthday. You pay for your own drinks.', fx: { mental: 1, money: -300 } },
  personal: { title: 'Journal Entry', text: 'You write down three things you are grateful for. One of them is snacks.', fx: { virtue: 1 } },
};

export const BONUS = {
  career: [
    { title: 'Overtime', text: 'Your manager "loves your hustle." You love sleep. Sleep loses.', fx: { money: 1500, mental: -1 } },
    { title: 'Office Pizza', text: 'Free pizza in the break room, in lieu of a raise.', fx: { mental: 1 } },
    { title: 'Performance Review', text: '"Meets expectations." A 2% raise against 4% inflation.', fx: { money: 500, mental: -1 } },
  ],
  health: [
    { title: 'Gym Streak', text: 'Three whole visits in a row. You buy matching workout gear to celebrate.', fx: { mental: 1, money: -200 } },
    { title: 'Urgent Care Copay', text: 'It was a sinus infection. It was also $400.', fx: { money: -400 } },
    { title: 'Eight Hours of Sleep', text: 'A medical miracle. Scientists want to study you.', fx: { mental: 2 } },
  ],
  social: [
    { title: 'Group Chat Drama', text: 'You muted it. You still read every message.', fx: { mental: -1 } },
    { title: 'Wedding Season', text: 'Three weddings, two bachelor parties, one registry for a $400 toaster.', fx: { money: -800, mental: 1 } },
    { title: 'Brunch', text: 'Bottomless mimosas, bottomless bill.', fx: { money: -150, mental: 1 } },
  ],
  personal: [
    { title: 'Meditation App Trial', text: 'Seven days free. You will forget to cancel.', fx: { mental: 1, money: -70 } },
    { title: 'Side Hustle', text: 'Your Etsy shop sold a candle. To your mom.', fx: { money: 800 } },
    { title: 'Library Card', text: 'You rediscover that books are free. Capitalism is shaken.', fx: { mental: 1, virtue: 1 } },
  ],
};

const walk = (label = 'Walk away') => ({ label, fx: {} });

export const SIN = [
  // career
  { id: 'embezzle', ring: 'career', title: 'Petty Cash', text: 'The petty cash box at work has no lock and nobody counts it. Nobody.',
    choices: [{ label: 'Skim $5,000', fx: { money: 7500, sin: 3, mental: -1 } }, walk('Leave it alone')] },
  { id: 'resume', ring: 'career', title: 'Creative Resume', text: 'The job wants a master\'s degree. You have a master\'s in vibes.',
    choices: [{ label: 'Lie about the degree', fx: { money: 3000, sin: 2 }, later: { in: 3, fx: { mental: -2 }, text: 'HR asks for your diploma. You panic-sweat through a blazer.' } }, walk('Apply honestly')] },
  { id: 'credit', ring: 'career', title: 'Credit Where It\'s Due', text: 'Your coworker\'s idea is great. Your boss thinks it\'s yours.',
    choices: [{ label: 'Take the credit', fx: { money: 2000, sin: 2 } }, { label: 'Correct the record', fx: { virtue: 1, mental: -1 } }] },
  { id: 'crypto_shill', ring: 'career', title: 'Crypto Influencer', text: 'A startup will pay you to tell your followers $GRIFT is "going to the moon."',
    choices: [{ label: 'Shill the coin', fx: { money: 4500, sin: 3 }, others: { money: -500 } }, walk('Log off')] },
  { id: 'easy_money', ring: 'career', title: 'Easy Money', text: 'A shady contact offers quick cash for "no questions asked" work. It\'s probably fine.',
    choices: [{ label: 'Take the job', fx: { money: 4000, sin: 2 }, later: { in: 2, fx: { money: -1500, mental: -1 }, text: 'Your shady contact wants a "small favor" back. Lawyers are expensive.' } }, { label: 'Walk away clean', fx: { virtue: 1, mental: 1 } }] },
  { id: 'soul', ring: 'career', title: 'Soul Advance', text: 'A man in a very nice suit offers $8,000 for "a small thing you won\'t miss."',
    choices: [{ label: 'Sign in blood', fx: { money: 12000, sin: 4 }, later: { in: 4, fx: { mental: -3 }, text: 'The man in the nice suit came to collect. You feel... hollow.' } }, walk('Back away slowly')] },
  // health
  { id: 'sick_day', ring: 'health', title: 'Fake Sick Day', text: 'You are not sick. Netflix asks if you are still watching. You are.',
    choices: [{ label: 'Call in "sick"', fx: { mental: 2, sin: 1 } }, walk('Go to work')] },
  { id: 'ghost_therapist', ring: 'health', title: 'Ghost Your Therapist', text: 'Your therapist called you out on your nonsense. Rude.',
    choices: [{ label: 'Never go back', fx: { money: 1000, sin: 1, mental: -2 } }, { label: 'Show up anyway', fx: { money: -150, mental: 1, virtue: 1 } }] },
  { id: 'wellness_cult', ring: 'health', title: 'Wellness Retreat', text: 'The retreat is $2,000, all-inclusive, and the founder has "a lot of wives."',
    choices: [{ label: 'Recruit your friends', fx: { money: 2000, mental: 1, sin: 3 }, others: { mental: -1 } }, walk('Decline the Kool-Aid')] },
  // social
  { id: 'ex_gossip', ring: 'social', title: 'Subtweet Your Ex', text: 'Your ex just posted a gym selfie. You have a lot of thoughts and a phone.',
    choices: [{ label: 'Post the thread', fx: { mental: 1, sin: 2 } }, walk('Close the app')] },
  { id: 'lunch_thief', ring: 'social', title: 'Labeled Leftovers', text: 'Your roommate\'s pad thai has their name on it in Sharpie. It smells incredible.',
    choices: [{ label: 'Eat it', fx: { mental: 1, sin: 1 } }, walk('Make toast')] },
  { id: 'mlm', ring: 'social', title: 'MLM, But Make It Vapes', text: 'Your high school friend has a "ground floor opportunity." It\'s a pyramid. With vapes.',
    choices: [{ label: 'Recruit everyone you know', fx: { money: 3000, sin: 3 }, others: { money: -300 } }, { label: 'Join, but quietly', fx: { money: -500, sin: 1 }, later: { in: 2, fx: { money: 2000 }, text: 'Your downline bought a lot of vapes. You are, briefly, a boss babe.' } }, walk('Leave them on read')] },
  { id: 'cancel', ring: 'social', title: 'Cancel the Competition', text: 'You have screenshots of your rival\'s tweets from 2011.',
    choices: [{ label: 'Release the screenshots', fx: { sin: 2, mental: 1 }, others: { mental: -1 } }, walk('Delete them')] },
  // personal
  { id: 'pyramid_oils', ring: 'personal', title: 'Essential Oils Empire', text: 'Lavender cures anxiety, cancer and taxes. Probably.',
    choices: [{ label: 'Start selling', fx: { sin: 2 }, later: { in: 2, fx: { money: 4500 }, text: 'Your oil empire pays out. Your aunts will never forgive you.' } }, walk('Just smell them')] },
  { id: 'dropship', ring: 'personal', title: 'Dropshipping Dreams', text: 'Counterfeit designer bags, shipped from a warehouse you will never see.',
    choices: [{ label: 'Launch the store', fx: { money: 4000, sin: 2 } }, walk('Keep scrolling')] },
  { id: 'deepfake', ring: 'personal', title: 'AI Glow-Up', text: 'An app will deepfake your dating profile into someone with cheekbones.',
    choices: [{ label: 'Upload the fake', fx: { mental: 2, sin: 1 }, later: { in: 2, fx: { mental: -2 }, text: 'Your date arrives. Their face says everything.' } }, walk('Post the real you')] },
  { id: 'tax_tok', ring: 'personal', title: 'Tax Haven TikTok', text: 'Your video "How I pay $0 in taxes (legally?)" could go viral.',
    choices: [{ label: 'Post it', fx: { money: 2000, sin: 2 } }, walk('Pay your taxes, nerd')] },
];

export const VIRTUE = [
  // career
  { id: 'mentor', ring: 'career', title: 'The New Hire', text: 'The new hire is drowning. Helping them means staying late, unpaid.',
    choices: [{ label: 'Stay late and mentor', fx: { virtue: 2, mental: -1 } }, walk('Clock out')] },
  { id: 'whistle', ring: 'career', title: 'Whistleblower', text: 'Your company is dumping chemicals in the river. You have the emails.',
    choices: [{ label: 'Leak to the press', fx: { virtue: 3, money: -3000, mental: -1 } }, { label: 'Look the other way', fx: { sin: 1, money: 500 } }] },
  { id: 'coding_kids', ring: 'career', title: 'Code Club', text: 'The library needs someone to teach coding to kids on Saturdays.',
    choices: [{ label: 'Volunteer', fx: { mental: -1 }, later: { in: 3, fx: { virtue: 3 }, text: 'A kid from Code Club got an internship. They thanked you in their essay.' } }, walk('Sleep in')] },
  // health
  { id: 'plasma', ring: 'health', title: 'Plasma for a Stranger', text: 'A coworker\'s kid needs surgery. You could donate plasma and give them the cash.',
    choices: [{ label: 'Donate and give it away', fx: { virtue: 2, mental: -1 } }, { label: 'Donate and keep the cash', fx: { money: 300, mental: -1 } }, walk('Needles? No thanks')] },
  { id: 'therapy', ring: 'health', title: 'Therapy Breakthrough', text: 'Your therapist thinks you\'re close to processing something big.',
    choices: [{ label: 'Book more sessions', fx: { money: -1000, mental: 3, virtue: 1 }, cost: 1000 }, walk('Repress it')] },
  { id: 'organ', ring: 'health', title: 'Living Donor', text: 'A stranger needs a kidney. You have two. The math is right there.',
    choices: [{ label: 'Donate a kidney', fx: { virtue: 6, money: -500, mental: -2 } }, walk('Keep both')] },
  { id: 'doomscroll', ring: 'health', title: 'Delete the Doomscroll', text: 'Your screen time report says 9 hours a day. It is judging you.',
    choices: [{ label: 'Delete social media', fx: { mental: 2, money: -500 } }, walk('Scroll on')] },
  // social
  { id: 'grandma', ring: 'social', title: 'Call Grandma', text: 'Grandma has called four times. She just wants to tell you about her neighbor\'s cat.',
    choices: [{ label: 'Call her back', fx: { virtue: 2, mental: -1 } }, walk('Text "busy, love u"')] },
  { id: 'listen', ring: 'social', title: 'Actually Listen', text: 'Your friend is venting. You have a related story that is much more interesting.',
    choices: [{ label: 'Just listen', fx: { virtue: 1 } }, { label: 'Tell your story', fx: { mental: 1, sin: 1 } }] },
  { id: 'wallet', ring: 'social', title: 'The Wallet', text: 'You find a wallet with $2,000 cash and an ID.',
    choices: [{ label: 'Return it, cash and all', fx: { virtue: 1, mental: 1 } }, { label: 'Keep the cash, mail the ID', fx: { money: 2000, sin: 1 } }] },
  { id: 'refugee', ring: 'social', title: 'The Spare Room', text: 'A refugee family needs somewhere to stay for a few months.',
    choices: [{ label: 'Offer your spare room', fx: { virtue: 4, money: -2000 }, cost: 2000 }, walk('It\'s "not a good time"')] },
  { id: 'help_neighbor', ring: 'social', title: 'Help a Neighbor', text: 'Your elderly neighbor needs help moving a piano. Your back is already filing a complaint.',
    choices: [{ label: 'Help them out', fx: { virtue: 2, mental: -1, money: -100 } }, walk('Make an excuse')] },
  { id: 'bail_fund', ring: 'social', title: 'Bail Fund', text: 'A community bail fund is short this month.',
    choices: [{ label: 'Donate $1,500', fx: { virtue: 3, money: -1500 }, cost: 1500 }, walk('Not your problem')] },
  // personal
  { id: 'senior_dog', ring: 'personal', title: 'Senior Dog', text: 'A 12-year-old beagle at the shelter has been waiting a year. He has one ear.',
    choices: [{ label: 'Adopt him', fx: { virtue: 1, mental: 3, money: -1500 } }, walk('Keep walking')] },
  { id: 'garden', ring: 'personal', title: 'Community Garden', text: 'The vacant lot down the street could be a garden. Someone just has to start.',
    choices: [{ label: 'Start it', fx: { money: -500, mental: -1 }, later: { in: 2, fx: { virtue: 2, mental: 1 }, text: 'The community garden is thriving. Someone grew a 40-pound zucchini.' } }, walk('Someone else will')] },
  { id: 'apology', ring: 'personal', title: 'Public Apology', text: 'You were wrong. Like, publicly wrong. People remember.',
    choices: [{ label: 'Apologize and mean it', fx: { virtue: 1, sin: -1, mental: -2 } }, { label: 'Double down', fx: { sin: 1, mental: 1 } }] },
  { id: 'coffee_chain', ring: 'personal', title: 'Pay It Forward', text: 'You could pay for the coffee of the person behind you in the drive-thru. It\'s a van. They\'re ordering for the whole office.',
    choices: [{ label: 'Pay it forward', fx: { virtue: 1, money: -300 } }, walk('Just your latte')] },
  { id: 'forgive', ring: 'personal', title: 'Forgive the Fraudster', text: 'The guy who scammed you is broke and asking for forgiveness.',
    choices: [{ label: 'Forgive him', fx: { virtue: 1, mental: 1 } }, { label: 'Sue him for everything', fx: { money: 2000, sin: 1, mental: -1 } }] },
];

export const CHAOS = [
  // career
  { id: 'crypto', ring: 'career', title: 'Crypto Chaos', text: 'Your portfolio just moved. A lot. In some direction.',
    choices: [{ label: 'Check your portfolio', roll: [
      { upTo: 2, fx: { money: -3000, mental: -1 }, text: 'It went to zero. Diamond hands, empty wallet.' },
      { upTo: 4, fx: { money: 500 }, text: 'Up a little. You tell everyone you are a genius.' },
      { upTo: 6, fx: { money: 4000, mental: 1 }, text: 'To the moon! You screenshot it for posterity.' }] },
    { label: 'Don\'t look', fx: { mental: 1 } }] },
  { id: 'layoffs', ring: 'career', title: 'Restructuring', text: 'HR booked a "quick sync" with no agenda.',
    choices: [{ label: 'Attend the meeting', roll: [
      { upTo: 2, fx: { money: -2500, mental: -2 }, text: 'Laid off by a Zoom call with your camera off.' },
      { upTo: 5, fx: { mental: -1 }, text: 'You survived. Your desk mate did not.' },
      { upTo: 6, fx: { money: 2000 }, text: 'Promoted into your boss\'s old job. Their stapler is yours.' }] }] },
  { id: 'algorithm', ring: 'career', title: 'Algorithm Change', text: 'The platform you sell on changed its algorithm overnight.',
    choices: [{ label: 'Refresh your stats', roll: [
      { upTo: 3, fx: { money: -1500 }, text: 'Your reach dropped 90%. Your posts now go only to your mom.' },
      { upTo: 6, fx: { money: 1500 }, text: 'You\'re suddenly on everyone\'s For You page. Lucky.' }] }] },
  // health
  { id: 'vet_bill', ring: 'health', title: 'Emergency Vet Visit', text: 'Your cat ate a hair tie. Surgery is $3,000.',
    choices: [{ label: 'Pay the full bill', fx: { money: -3000, mental: 1, virtue: 1 }, cost: 3000 },
      { label: 'Find a cheaper vet', fx: { money: -1500, mental: -1 }, cost: 1500 },
      { label: 'You can\'t afford it', fx: { mental: -3, sin: 1 } }] },
  { id: 'insurance', ring: 'health', title: 'Insurance Denied', text: 'Your claim was denied for "reasons." The reasons are profit.',
    choices: [{ label: 'Pay out of pocket', fx: { money: -2000 } }, { label: 'Fight it on the phone for 6 hours', fx: { mental: -2, money: -300 } }] },
  { id: 'burnout', ring: 'health', title: 'Burnout', text: 'You cried in a Target parking lot. It\'s Tuesday.',
    choices: [{ label: 'Take a mental health week', fx: { mental: 3, money: -1200 } }, { label: 'Push through', fx: { mental: -2, money: 500 } }] },
  { id: 'lottery_scratch', ring: 'health', title: 'Gas Station Scratcher', text: 'Your hands are shaking. That\'s the coffee. Or hope.',
    choices: [{ label: 'Scratch it', roll: [
      { upTo: 4, fx: { money: -20 }, text: 'Nothing. As expected. As always.' },
      { upTo: 5, fx: { money: 500, mental: 1 }, text: '$500! You buy everyone a round.' },
      { upTo: 6, fx: { money: 5000, mental: 2 }, text: 'FIVE THOUSAND DOLLARS. You quit nothing, but you think about it.' }] }] },
  // social
  { id: 'viral', ring: 'social', title: 'You Went Viral', text: 'A stranger filmed you at the grocery store. The internet has opinions.',
    choices: [{ label: 'Read the comments', roll: [
      { upTo: 3, fx: { mental: -2 }, text: 'You are now "Cart Guy." Strangers recognize you. Not fondly.' },
      { upTo: 6, fx: { mental: 1, money: 1000 }, text: 'You\'re a wholesome meme! A brand sends you free snacks.' }] }, { label: 'Never open the app again', fx: { mental: -1 } }] },
  { id: 'family_loan', ring: 'social', title: 'The Family Loan', text: 'Your cousin needs $2,000 "just until Friday." Which Friday is unclear.',
    choices: [{ label: 'Lend it', fx: { money: -2000, virtue: 1 }, cost: 2000, later: { in: 3, fx: { money: 1000 }, text: 'Your cousin paid back half! A miracle, by family standards.' } }, { label: 'Say no', fx: { mental: -1 } }] },
  { id: 'reunion', ring: 'social', title: 'High School Reunion', text: 'Everyone will be there. Including the person who peaked in 11th grade. Is it you?',
    choices: [{ label: 'Go', roll: [
      { upTo: 3, fx: { mental: -2, money: -200 }, text: 'Everyone has a boat. You have a Honda.' },
      { upTo: 6, fx: { mental: 2, money: -200 }, text: 'You look great. Your bully is selling insurance. Justice.' }] }, walk('Stay home')] },
  // personal
  { id: 'side_project', ring: 'personal', title: 'The Side Project', text: 'Your app idea is "Uber, but for feelings."',
    choices: [{ label: 'Quit your job for it', roll: [
      { upTo: 4, fx: { money: -3000, mental: -1 }, text: 'Turns out people don\'t want Uber for feelings.' },
      { upTo: 6, fx: { money: 6000, mental: 2 }, text: 'Acquired! By a company that will shut it down in a month. Still, money.' }] }, walk('Keep it a dream')] },
  { id: 'inheritance', ring: 'personal', title: 'Mysterious Inheritance', text: 'A great-aunt you never met left you something.',
    choices: [{ label: 'Open the envelope', roll: [
      { upTo: 2, fx: { money: -500 }, text: 'It\'s her debts. Thanks, Aunt Linda.' },
      { upTo: 4, fx: { mental: 1 }, text: 'A ceramic frog collection. You feel strangely at peace.' },
      { upTo: 6, fx: { money: 4000 }, text: 'A savings bond from 1987! It matured nicely.' }] }] },
  { id: 'astrology', ring: 'personal', title: 'Mercury in Retrograde', text: 'Your horoscope says to avoid big decisions. You have three due today.',
    choices: [{ label: 'Trust the stars', fx: { mental: 1, money: -500 } }, { label: 'Trust spreadsheets', fx: { money: 500, mental: -1 } }] },
];

// Town-wide events, every few rounds. fx applies to everyone. `richest`/`poorest` apply to the extremes,
// and `moneyPct` takes a percentage of each player's positive balance.
export const BABEL_EVENTS = [
  { id: 'crash', title: 'Market Crash', text: 'The Babel Stock Exchange lost 30% before lunch. The rich lose the most, and it hurts their feelings.', moneyPct: -0.25, fx: { mental: -1 } },
  { id: 'inflation', title: 'Eggflation', text: 'A dozen eggs now costs $14. Babel learns to love oatmeal.', fx: { money: -800 } },
  { id: 'heatwave', title: 'Record Heatwave', text: 'It\'s 114 degrees in Babel. The AC bill is a horror story.', fx: { money: -400, mental: -1 } },
  { id: 'stimulus', title: 'Stimulus Check', text: 'The Babel government mails everyone a check, and a letter taking credit for it.', fx: { money: 1200, mental: 1 } },
  { id: 'trend', title: 'Kindness Goes Viral', text: 'A challenge where people do one nice thing a day takes over Babel. For one week, everyone is a saint.', fx: { virtue: 1, mental: 1 } },
  { id: 'audit', title: 'The Big Audit', text: 'The Babel Revenue Service is auditing the town\'s richest resident.', richest: { money: -3000, mental: -1 }, poorest: { mental: 1 } },
  { id: 'scandal', title: 'Mayor Scandal', text: 'The mayor of Babel was caught with a basement full of stolen catalytic converters. Everyone feels a little better about themselves.', fx: { sin: -1, mental: 1 } },
  { id: 'housing', title: 'Housing Bubble', text: 'Rent in Babel went up 40%. Your landlord bought a third boat.', fx: { money: -1500 }, richest: { money: 2000 } },
  { id: 'outage', title: 'The Great Outage', text: 'The internet is down across Babel for 48 hours. People talk to their neighbors. It\'s terrifying.', fx: { mental: 1, virtue: 1, money: -300 } },
  { id: 'layoff_wave', title: 'Tech Layoff Wave', text: 'Babel\'s biggest company replaced 30% of its staff with a chatbot.', fx: { mental: -1 }, poorest: { money: -1000, mental: -1 } },
];

// The birth lottery. Picked at random, because life is like that.
export const BACKGROUNDS = [
  { id: 'trust', name: 'Trust Fund Kid', money: 13000, mental: 5, sin: 2, virtue: 0 },
  { id: 'office', name: 'Office Worker', money: 8000, mental: 6, sin: 1, virtue: 0 },
  { id: 'nurse', name: 'Night-Shift Nurse', money: 6000, mental: 5, sin: 0, virtue: 2 },
  { id: 'retail', name: 'Retail Worker', money: 4000, mental: 7, sin: 0, virtue: 1 },
  { id: 'artist', name: 'Starving Artist', money: 2000, mental: 8, sin: 0, virtue: 1 },
  { id: 'student', name: 'Grad Student', money: 500, mental: 7, sin: 0, virtue: 1 },
];

export const TRAITS = [
  { id: 'career_junkie', name: 'Career Junkie', text: 'Career money gains +50%, but Career costs you 1 extra mental.' },
  { id: 'fragile', name: 'Fragile Health', text: 'Mental changes on the Health ring are doubled.' },
  { id: 'butterfly', name: 'Social Butterfly', text: 'Mental gains on the Social ring +1. Mental losses there +1 too.' },
  { id: 'zen', name: 'Zen Minimalist', text: '+1 virtue on every Personal card, but all money gains -25%.' },
  { id: 'crisis_magnet', name: 'Crisis Magnet', text: 'Babel events hit you twice as hard.' },
];
