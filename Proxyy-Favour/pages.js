const pageApi = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch('/api' + path, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            ...options,
            signal: controller.signal
        });
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error('The app returned an unreadable response. Restart Hangout and try again.');
        }
        if (!response.ok) throw new Error(result.error || 'Something went wrong.');
        return result;
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

const pageText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const formatBalance = value => `${Number(value) > 0 ? '+' : ''}${Number(value) || 0}`;
const pagePaisa = '<span class="paisa-symbol" aria-label="ProxyPaisa"><span aria-hidden="true">P</span><span class="paisa-mark" aria-hidden="true">₱</span></span>';
let canRequestTreat = false;
let currentTreatAvailable = 0;
let currentTreatBaseNote = '';
function updateTreatRequestState() {
    const selection = document.querySelector('#treatSelection');
    const submit = document.querySelector('#treatSubmit');
    const selected = selection?.selectedOptions?.[0];
    const customFields = document.querySelector('#customTreatFields');
    const customName = document.querySelector('#customTreatName');
    const customCost = document.querySelector('#customTreatCost');
    const balanceNote = document.querySelector('#treatBalanceNote');
    const isCustom = selected?.value === 'custom';

    if (customFields) customFields.hidden = !isCustom;
    if (customName) {
        customName.disabled = !isCustom;
        customName.required = isCustom;
    }
    if (customCost) {
        customCost.disabled = !isCustom;
        customCost.required = isCustom;
    }

    const cost = Number(customCost?.value);
    const validCustomCost = Number.isSafeInteger(cost) && cost >= 1;
    const customIsValid = Boolean(customName?.value.trim() && validCustomCost && cost <= currentTreatAvailable);
    if (balanceNote) {
        balanceNote.textContent = isCustom && validCustomCost && cost > currentTreatAvailable
            ? `Custom dish costs ${cost} P ₱; you need ${cost - currentTreatAvailable} more P ₱.`
            : currentTreatBaseNote;
    }

    canRequestTreat = Boolean(
        selected?.value && !selected.disabled && !selection.disabled &&
        (isCustom ? customIsValid : true)
    );
    if (submit) submit.disabled = !canRequestTreat;
}

document.querySelector('#treatSelection')?.addEventListener('change', updateTreatRequestState);
document.querySelector('#customTreatName')?.addEventListener('input', updateTreatRequestState);
document.querySelector('#customTreatCost')?.addEventListener('input', updateTreatRequestState);

const setCurrentDateTime = input => {
    if (!input) return;
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    input.value = now.toISOString().slice(0, 16);
};

function showRelationshipLoadError(error, allowRetry = true) {
    canRequestTreat = false;
    currentTreatAvailable = 0;
    currentTreatBaseNote = '';
    const signedOut = error.message.startsWith('Sign in to');
    const name = document.querySelector('#relationshipName');
    const department = document.querySelector('#relationshipDepartment');
    const balance = document.querySelector('#relationshipBalance');
    const available = document.querySelector('#availableBalance');
    const treatSelect = document.querySelector('#treatSelection');
    const treatSubmit = document.querySelector('#treatSubmit');
    const message = document.querySelector('#relationshipMessage');

    name.textContent = signedOut ? 'Sign in to view this ledger' : 'Ledger unavailable';
    department.textContent = signedOut ? 'Sign in to see your shared activity.' : 'Your shared balance will appear here when the ledger loads.';
    balance.textContent = '—';
    available.textContent = '—';
    document.querySelector('#givenCount').textContent = '—';
    document.querySelector('#receivedCount').textContent = '—';
    document.querySelector('#treatBalanceNote').textContent = '';
    treatSelect.innerHTML = '<option value="">Treats unavailable</option>';
    treatSelect.disabled = true;
    treatSubmit.disabled = true;
    updateTreatRequestState();
    if (signedOut) {
        message.innerHTML = 'Sign in to see this relationship. <a href="/sign%20up/">Sign in</a>.';
    } else if (allowRetry) {
        message.innerHTML = `${pageText(error.message)} <button type="button" class="activity-confirm" data-retry-relationship>Retry</button>`;
    } else {
        message.innerHTML = `${pageText(error.message)} <a href="/people.html">Back to your circle</a>.`;
    }
}

const relationshipMessageNode = document.querySelector('#relationshipMessage');
relationshipMessageNode?.addEventListener('click', event => {
    if (!event.target.closest('[data-retry-relationship]')) return;
    event.preventDefault();
    loadRelationshipPage();
});

async function loadPeoplePage() {
    const container = document.querySelector('#peopleList');
    if (!container) return;
    try {
        const session = await pageApi('/me');
        if (!session.user) {
            container.innerHTML = '<div class="activity-empty">Sign in to see your people and balances. <a href="/sign%20up/">Sign in</a>.</div>';
            return;
        }
        const { people } = await pageApi('/people');
        if (!people.length) {
            container.innerHTML = '<div class="activity-empty">Your circle is quiet for now. Invite someone to join Proxy.</div>';
            return;
        }
        container.innerHTML = people.map((person, index) => {
            const amountClass = person.balance > 0 ? 'positive' : person.balance < 0 ? 'negative' : 'even';
            const history = `${person.given} given · ${person.received} received`;
            const balanceHint = person.balance > 0 ? 'they owe you' : person.balance < 0 ? 'you owe them' : 'balanced';
            return `<a class="person-row person-link glass-surface glass-tilt" href="/person.html?id=${person.id}">
                <span class="person-rank">${String(index + 1).padStart(2, '0')}</span>
                <span class="person-copy"><span class="person-name">${pageText(person.name)}</span>
                    <span class="person-department">${pageText(person.department)} · ${history}</span></span>
                <span class="person-coins ${amountClass}">${formatBalance(person.balance)} ${pagePaisa}<small>${balanceHint}</small></span>
            </a>`;
        }).join('');
    } catch (error) {
        container.innerHTML = `<div class="activity-empty">${pageText(error.message)}</div>`;
    }
}

async function loadCreatePage() {
    const form = document.querySelector('#createPageForm');
    if (!form) return;
    const message = document.querySelector('#createPageMessage');
    const peopleSelect = document.querySelector('#createPerson');
    const button = document.querySelector('#createPageButton');
    try {
        const session = await pageApi('/me');
        if (!session.user) {
            form.querySelectorAll('input,select,button').forEach(control => control.disabled = true);
            message.innerHTML = 'Sign in to mark a proxy. <a href="/sign%20up/">Sign in</a>.';
            return;
        }
        const { people } = await pageApi('/people');
        peopleSelect.innerHTML = '<option value="">Choose a person</option>' + people
            .map(person => `<option value="${person.id}">${pageText(person.name)} · ${formatBalance(person.balance)} P ₱ with you</option>`)
            .join('');
        const defaultMessage = message.textContent;
        const updateBalanceWarning = () => {
            const selectedPerson = people.find(person => person.id === Number(peopleSelect.value));
            const outstandingDebt = Number(selectedPerson?.outstanding_debt) || 0;
            if (selectedPerson && outstandingDebt >= 10) {
                message.classList.add('balance-warning');
                message.textContent = `Warning: ${selectedPerson.name} has ${outstandingDebt} P ₱ outstanding across their separate relationships. Please avoid marking another proxy for them until this debt comes down.`;
                return;
            }
            message.classList.remove('balance-warning');
            message.textContent = defaultMessage;
        };
        peopleSelect.addEventListener('change', updateBalanceWarning);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            button.disabled = true;
            const beneficiaryId = Number(peopleSelect.value);
            try {
                await pageApi('/favours', {
                    method: 'POST',
                    body: JSON.stringify({ beneficiary_id: beneficiaryId, event_time: document.querySelector('#createTime').value })
                });
                form.reset();
                setCurrentDateTime(document.querySelector('#createTime'));
                updateBalanceWarning();
                message.innerHTML = `Proxy marked for ${pageText(people.find(person => person.id === beneficiaryId)?.name || 'your person')}. They can confirm it when it’s done. <a href="/person.html?id=${beneficiaryId}">View your proxy ledger</a>.`;
            } catch (error) {
                message.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        });
    } catch (error) {
        message.textContent = error.message;
    }
}

async function loadRelationshipPage() {
    const page = document.querySelector('#relationshipPage');
    if (!page) return;
    const message = document.querySelector('#relationshipMessage');
    const treatSelect = document.querySelector('#treatSelection');
    const treatSubmit = document.querySelector('#treatSubmit');
    const personId = Number(new URLSearchParams(window.location.search).get('id'));
    if (!Number.isInteger(personId) || personId < 1) {
        showRelationshipLoadError(new Error('Choose someone from your circle to see your shared activity.'), false);
        return;
    }
    message.textContent = '';
    canRequestTreat = false;
    treatSelect.disabled = true;
    treatSubmit.disabled = true;
    currentTreatAvailable = 0;
    currentTreatBaseNote = '';
    try {
        const result = await pageApi(`/people/${personId}`);
        const { person, relationship, treats } = result;
        document.title = `${person.name} · Proxy ledger | Hangout`;
        document.querySelector('#relationshipName').textContent = person.name;
        document.querySelector('#treatHeading').textContent = `Redeem a treat with ${person.name}`;
        document.querySelector('#relationshipDepartment').textContent = person.department;
        document.querySelector('#relationshipBalance').innerHTML = `${formatBalance(relationship.balance)} ${pagePaisa}`;
        document.querySelector('#relationshipBalanceCaption').textContent = relationship.balance > 0
            ? `${person.name} owes you ${relationship.balance} P ₱ for proxies you covered.`
            : relationship.balance < 0 ? `You owe ${person.name} ${Math.abs(relationship.balance)} P ₱ for proxies they covered.` : 'Your proxy balance is even.';
        document.querySelector('#availableBalance').innerHTML = `${relationship.available} ${pagePaisa}`;
        document.querySelector('#availableCaption').textContent = relationship.reserved
            ? `${relationship.reserved} P ₱ reserved for a pending treat request.`
            : `Only usable with ${person.name}.`;
        document.querySelector('#givenCount').textContent = relationship.given;
        document.querySelector('#receivedCount').textContent = relationship.received;
        currentTreatAvailable = Number(relationship.available) || 0;
        currentTreatBaseNote = `Available with ${person.name}: ${relationship.available} P ₱`;
        treatSelect.innerHTML = '<option value="">Choose a treat</option>' + treats.map(treat => {
            const short = Math.max(0, treat.cost - relationship.available);
            const need = short ? ` · need ${short} more P ₱` : '';
            return `<option value="${pageText(treat.key)}" ${short ? 'disabled' : ''}>${pageText(treat.name)} · ${treat.cost} P ₱${need}</option>`;
        }).join('') + '<option value="custom">Custom dish…</option>';
        treatSelect.disabled = false;
        treatSelect.value = '';
        updateTreatRequestState();
        document.querySelector('#treatBalanceNote').textContent = currentTreatBaseNote;
        message.textContent = '';
    } catch (error) {
        canRequestTreat = false;
        showRelationshipLoadError(error);
    }
}

const createPageForm = document.querySelector('#createPageForm');
if (createPageForm) loadCreatePage();

const createTime = document.querySelector('#createTime');
setCurrentDateTime(createTime);

const createTreatForm = document.querySelector('#treatForm');
if (createTreatForm) createTreatForm.addEventListener('submit', async event => {
    event.preventDefault();
    const personId = Number(new URLSearchParams(window.location.search).get('id'));
    const button = document.querySelector('#treatSubmit');
    const message = document.querySelector('#treatMessage');
    button.disabled = true;
    try {
        const treatKey = document.querySelector('#treatSelection').value;
        const request = { provider_id: personId, treat_key: treatKey };
        if (treatKey === 'custom') {
            request.custom_name = document.querySelector('#customTreatName').value.trim();
            request.custom_cost = Number(document.querySelector('#customTreatCost').value);
        }
        await pageApi('/treat-redemptions', {
            method: 'POST',
            body: JSON.stringify(request)
        });
        message.textContent = 'Treat requested. These ProxyPaisa are reserved and will be deducted when it is marked delivered.';
        createTreatForm.reset();
        await loadRelationshipPage();
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = !canRequestTreat;
    }
});

loadPeoplePage();
loadRelationshipPage();
