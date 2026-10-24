const pageApi = async (path, options = {}) => {
    const response = await fetch('/api' + path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
};
const pageText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const pageTime = value => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

async function loadPeoplePage() {
    const container = document.querySelector('#peopleList');
    if (!container) return;
    try {
        const { people } = await pageApi('/leaderboard');
        container.innerHTML = people.map((person, index) => `<article class="person-row glass-surface glass-tilt"><span class="person-rank">${String(index + 1).padStart(2, '0')}</span><div><div class="person-name">${pageText(person.name)}</div><div class="person-department">${pageText(person.department)}</div></div><span class="person-coins">${person.coins} FC</span></article>`).join('');
    } catch (error) {
        container.innerHTML = `<div class="activity-empty">${pageText(error.message)}</div>`;
    }
}

async function loadCreatePage() {
    const form = document.querySelector('#createPageForm');
    if (!form) return;
    const message = document.querySelector('#createPageMessage');
    const peopleSelect = document.querySelector('#createPerson');
    const activity = document.querySelector('#createPageActivity');
    const button = document.querySelector('#createPageButton');
    const session = await pageApi('/me');
    if (!session.user) {
        form.querySelectorAll('input,select,button').forEach(control => control.disabled = true);
        message.textContent = 'Sign in from the navigation bar to create a favour.';
        activity.innerHTML = '';
        return;
    }
    const [peopleResult, favoursResult] = await Promise.all([pageApi('/people'), pageApi('/favours')]);
    peopleSelect.innerHTML = '<option value="">Choose a person</option>' + peopleResult.people
        .map(person => `<option value="${person.id}">${pageText(person.name)} · ${pageText(person.department)}</option>`).join('');
    const favours = favoursResult.favours;
    activity.innerHTML = favours.length ? favours.map(item => {
        const incoming = item.beneficiary_id === session.user.id;
        const otherName = incoming ? item.creator_name : item.beneficiary_name;
        const state = item.status === 'confirmed' ? 'Confirmed' : item.status === 'declined' ? 'Not confirmed' : incoming ? 'Needs your confirmation' : 'Waiting for confirmation';
        const action = item.status === 'pending' && incoming ? `<button class="activity-confirm" data-page-confirm="${item.id}">Confirm favour</button>` : '';
        return `<article class="activity-row glass-surface glass-tilt"><div><div class="activity-title">${pageText(item.title)}</div><div class="activity-meta">${incoming ? 'From' : 'For'} ${pageText(otherName)} · ${pageText(pageTime(item.event_time))}</div>${action}</div><span class="activity-state ${item.status}">${state}</span></article>`;
    }).join('') : '<div class="activity-empty">No favours in your circle yet.</div>';
    activity.querySelectorAll('[data-page-confirm]').forEach(control => control.addEventListener('click', async () => {
        control.disabled = true;
        try {
            await pageApi(`/favours/${control.dataset.pageConfirm}/confirm`, { method: 'POST', body: '{}' });
            message.textContent = 'Confirmed. Your balance increased by one Favourcoin; no one’s balance went down.';
            await loadCreatePage();
        } catch (error) {
            control.disabled = false;
            message.textContent = error.message;
        }
    }));
}

const createPageForm = document.querySelector('#createPageForm');
if (createPageForm) createPageForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.querySelector('#createPageButton');
    button.disabled = true;
    try {
        await pageApi('/favours', {
            method: 'POST',
            body: JSON.stringify({ beneficiary_id: document.querySelector('#createPerson').value, event_time: document.querySelector('#createTime').value })
        });
        document.querySelector('#createPageMessage').textContent = 'Favour created for that person at the selected time. They can confirm it when it’s done.';
        form.reset();
        await loadCreatePage();
    } catch (error) {
        document.querySelector('#createPageMessage').textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

const createTime = document.querySelector('#createTime');
if (createTime) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    createTime.value = now.toISOString().slice(0, 16);
}
loadPeoplePage();
loadCreatePage().catch(error => {
    const message = document.querySelector('#createPageMessage');
    if (message) message.textContent = error.message;
});
