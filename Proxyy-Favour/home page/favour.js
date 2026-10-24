const favourApi = async (path, options = {}) => {
    const response = await fetch('/api' + path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
};

const favourState = { user: null, people: [], favours: [], claims: [] };
const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function localDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

function renderFavourSummary() {
    const coins = favourState.user?.coins ?? 0;
    document.querySelector('#coinBalance').innerHTML = `${coins} <small>FC</small>`;
    document.querySelector('#balanceCaption').textContent = favourState.user
        ? `${favourState.user.name} · coins only go up`
        : 'Sign in to see your Favourcoins';
    const pending = favourState.favours.filter(item => item.status === 'pending').length;
    const confirmed = favourState.favours.filter(item => item.status === 'confirmed').length;
    document.querySelector('#favourCount').textContent = favourState.user ? `${pending} / ${confirmed}` : '—';
    document.querySelector('#favourCaption').textContent = favourState.user
        ? 'Awaiting confirmation / confirmed'
        : 'Favours confirmed by people';
    const pakodaClaimed = favourState.claims.includes('pakoda');
    const biryaniClaimed = favourState.claims.includes('biryani');
    let reward = null;
    if (!pakodaClaimed) reward = { key: 'pakoda', name: 'Aloo pakoda', cost: 3 };
    else if (!biryaniClaimed) reward = { key: 'biryani', name: 'Hyderabadi biryani', cost: 5 };
    document.querySelector('#nextReward').textContent = reward ? reward.name : 'Both treats claimed';
    document.querySelector('#rewardCaption').textContent = reward
        ? coins < reward.cost ? `${reward.cost - coins} more coin${reward.cost - coins === 1 ? '' : 's'} · balance stays yours` : `${reward.cost} Favourcoins · balance stays yours`
        : 'You have claimed both campus treats';
    const claimButton = document.querySelector('#claimReward');
    claimButton.disabled = !favourState.user || !reward || coins < reward.cost;
    claimButton.dataset.reward = reward?.key || '';
    claimButton.textContent = !favourState.user ? 'Sign in to claim' : !reward ? 'Both treats claimed' : coins < reward.cost ? `Earn ${reward.cost - coins} more` : `Claim ${reward.name}`;
}

function renderPeople() {
    const select = document.querySelector('#favourPerson');
    select.innerHTML = '<option value="">Choose a person</option>' + favourState.people
        .map(person => `<option value="${person.id}">${safeText(person.name)} · ${safeText(person.department)}</option>`)
        .join('');
}

function renderActivity() {
    const list = document.querySelector('#favourActivity');
    const count = document.querySelector('#activityCount');
    count.textContent = favourState.favours.length;
    if (!favourState.user) {
        list.innerHTML = '<div class="activity-empty">Sign in to see favours in your circle.</div>';
        return;
    }
    if (!favourState.favours.length) {
        list.innerHTML = '<div class="activity-empty">No favours yet. Create one for someone in your circle.</div>';
        return;
    }
    list.innerHTML = favourState.favours.map(item => {
        const incoming = item.beneficiary_id === favourState.user.id;
        const otherName = incoming ? item.creator_name : item.beneficiary_name;
        const statusText = item.status === 'confirmed' ? 'Confirmed' : item.status === 'declined' ? 'Not confirmed' : incoming ? 'Needs your confirmation' : 'Waiting for confirmation';
        const confirm = item.status === 'pending' && incoming
            ? `<button type="button" class="activity-confirm" data-confirm-favour="${item.id}">Confirm favour</button>` : '';
        return `<article class="activity-row glass-surface glass-tilt"><div><div class="activity-title">${safeText(item.title)}</div><div class="activity-meta">${incoming ? 'From' : 'For'} ${safeText(otherName)} · ${safeText(localDateTime(item.event_time))}</div>${confirm}</div><span class="activity-state ${item.status}">${statusText}</span></article>`;
    }).join('');
    list.querySelectorAll('[data-confirm-favour]').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await favourApi(`/favours/${button.dataset.confirmFavour}/confirm`, { method: 'POST', body: '{}' });
                await loadFavourData();
                document.querySelector('#favourMessage').textContent = 'Confirmed. Your Favourcoin balance went up by one. No one’s balance was deducted.';
            } catch (error) {
                button.disabled = false;
                document.querySelector('#favourMessage').textContent = error.message;
            }
        });
    });
}

async function loadFavourData() {
    try {
        const session = await favourApi('/me');
        favourState.user = session.user;
        favourState.claims = session.claims || [];
        if (favourState.user) {
            const [people, favours] = await Promise.all([favourApi('/people'), favourApi('/favours')]);
            favourState.people = people.people;
            favourState.favours = favours.favours;
            renderPeople();
            document.querySelector('#authLink').textContent = 'Sign out';
            document.querySelector('#authLink').href = '#sign-out';
            document.querySelector('#authLink').onclick = async event => {
                event.preventDefault();
                await favourApi('/logout', { method: 'POST', body: '{}' });
                window.location.reload();
            };
            document.querySelector('#favourForm').querySelectorAll('input,select,button').forEach(control => control.disabled = false);
            document.querySelector('#favourMessage').textContent = 'The person you helped confirms it when it’s done. Their balance goes up; yours never goes down.';
        } else {
            favourState.people = [];
            favourState.favours = [];
            document.querySelector('#authLink').textContent = 'Sign in';
            document.querySelector('#authLink').href = '/sign%20up/';
            document.querySelector('#authLink').onclick = null;
            document.querySelector('#favourForm').querySelectorAll('input,select,button').forEach(control => control.disabled = true);
            document.querySelector('#favourMessage').textContent = 'Sign in to create a favour. When they confirm, the other person’s balance goes up.';
        }
        renderFavourSummary();
        renderActivity();
    } catch (error) {
        document.querySelector('#favourMessage').textContent = 'Start the local server to connect the Favourcoin database.';
    }
}

document.querySelector('#favourForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#createFavourButton');
    button.disabled = true;
    try {
        await favourApi('/favours', {
            method: 'POST',
            body: JSON.stringify({
                beneficiary_id: document.querySelector('#favourPerson').value,
                event_time: document.querySelector('#favourTime').value
            })
        });
        event.target.reset();
        document.querySelector('#favourMessage').textContent = 'Favour created for that person at the selected time. They can confirm it when it’s done.';
        await loadFavourData();
    } catch (error) {
        document.querySelector('#favourMessage').textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#claimReward').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!button.dataset.reward) return;
    button.disabled = true;
    try {
        await favourApi('/rewards/claim', { method: 'POST', body: JSON.stringify({ reward: button.dataset.reward }) });
        await loadFavourData();
        document.querySelector('#favourMessage').textContent = 'Treat claimed. Your Favourcoin balance stays the same.';
    } catch (error) {
        document.querySelector('#favourMessage').textContent = error.message;
        button.disabled = false;
    }
});

const dateInput = document.querySelector('#favourTime');
if (dateInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
}
loadFavourData();

