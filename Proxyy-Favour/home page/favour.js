const favourApi = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch('/api' + path, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            ...options,
            signal: controller.signal
        });
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error('The app returned an unreadable response. Restart Hangout and try again.');
        }
        if (!response.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Hangout did not respond in time. Restart the app and try again.');
        }
        if (error instanceof TypeError) {
            throw new Error('Could not reach Hangout. Restart the app and try again.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const homeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const homeTime = value => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

async function loadProxyHome() {
    const activity = document.querySelector('#homeActivity');
    const message = document.querySelector('#homeMessage');
    message.textContent = '';
    try {
        const session = await favourApi('/me');
        if (!session.user) {
            document.querySelector('#homeGivenCount').textContent = '—';
            document.querySelector('#homeReceivedCount').textContent = '—';
            document.querySelector('#homePeopleCount').textContent = '—';
            document.querySelector('#homeGivenCaption').textContent = 'Sign in to see your activity';
            document.querySelector('#homeReceivedCaption').textContent = 'Each person has a separate balance';
            document.querySelector('#homePeopleCaption').textContent = 'Balances tracked person by person';
            activity.innerHTML = '<div class="activity-empty">Sign in to see proxy activity in your circle.</div>';
            return;
        }

        const [peopleResult, favourResult] = await Promise.all([favourApi('/people'), favourApi('/favours')]);
        const favours = favourResult.favours;
        const confirmed = favours.filter(item => item.status === 'confirmed');
        const given = confirmed.filter(item => item.creator_id === session.user.id).length;
        const received = confirmed.filter(item => item.beneficiary_id === session.user.id).length;
        document.querySelector('#homeGivenCount').textContent = given;
        document.querySelector('#homeReceivedCount').textContent = received;
        document.querySelector('#homePeopleCount').textContent = peopleResult.people.length;
        document.querySelector('#homeGivenCaption').textContent = 'Confirmed by them';
        document.querySelector('#homeReceivedCaption').textContent = 'Confirmed by you';
        document.querySelector('#homePeopleCaption').textContent = 'Each person has a separate balance';

        const activityTime = value => {
            const timestamp = new Date(value).valueOf();
            return Number.isFinite(timestamp) ? timestamp : 0;
        };
        const recent = [...favours].sort((a, b) =>
            activityTime(b.event_time) - activityTime(a.event_time) || Number(b.id) - Number(a.id)
        ).slice(0, 5);
        if (!recent.length) {
            activity.innerHTML = '<div class="activity-empty">No proxies yet. Your activity will appear here.</div>';
            return;
        }
        activity.innerHTML = recent.map(item => {
            const incoming = item.beneficiary_id === session.user.id;
            const personId = incoming ? item.creator_id : item.beneficiary_id;
            const personName = incoming ? item.creator_name : item.beneficiary_name;
            const detail = incoming ? `Proxy from ${homeText(personName)}` : `Proxy for ${homeText(personName)}`;
            const state = item.status === 'confirmed' ? 'Confirmed' : item.status === 'declined' ? 'Not confirmed' : incoming ? 'Needs your confirmation' : `Waiting on ${homeText(personName)}`;
            const direction = incoming ? 'decreases' : 'increases';
            const balanceDetail = item.status === 'confirmed'
                ? `Your balance with ${homeText(personName)} ${incoming ? 'decreased' : 'increased'} by 1 P ₱`
                : item.status === 'pending'
                    ? incoming
                        ? `If confirmed, your balance with ${homeText(personName)} ${direction} by 1 P ₱`
                        : `${homeText(personName)} needs to confirm. If confirmed, your balance with them increases by 1 P ₱`
                    : 'No ProxyPaisa changed hands';
            const confirmAction = incoming && item.status === 'pending'
                ? `<button type="button" class="activity-confirm" data-confirm-proxy="${homeText(item.id)}">Confirm proxy</button>`
                : '';
            return `<article class="activity-row glass-surface glass-tilt">
                <div class="activity-copy"><div class="activity-title">${detail}</div>
                    <div class="activity-meta">${homeText(homeTime(item.event_time))} · ${balanceDetail}</div></div>
                <div class="activity-side"><span class="activity-state ${homeText(item.status)}">${state}</span>
                    <a class="activity-person-link" href="/person.html?id=${personId}">Open ledger</a>${confirmAction}</div>
            </article>`;
        }).join('');
    } catch (error) {
        document.querySelector('#homeGivenCount').textContent = '—';
        document.querySelector('#homeReceivedCount').textContent = '—';
        document.querySelector('#homePeopleCount').textContent = '—';
        activity.innerHTML = `<div class="activity-empty">${homeText(error.message)} <button type="button" class="activity-confirm" data-retry-home>Retry</button></div>`;
    }
}

document.querySelector('#homeActivity')?.addEventListener('click', async event => {
    const retryButton = event.target.closest('[data-retry-home]');
    if (retryButton) {
        await loadProxyHome();
        return;
    }

    const confirmButton = event.target.closest('[data-confirm-proxy]');
    if (!confirmButton || confirmButton.disabled) return;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Confirming…';
    const message = document.querySelector('#homeMessage');
    try {
        await favourApi(`/favours/${confirmButton.dataset.confirmProxy}/confirm`, {
            method: 'POST',
            body: '{}'
        });
        await loadProxyHome();
        message.textContent = 'Proxy confirmed. Your shared balance has been updated.';
    } catch (error) {
        message.textContent = error.message;
        confirmButton.disabled = false;
        confirmButton.textContent = 'Confirm proxy';
    }
});

loadProxyHome();
