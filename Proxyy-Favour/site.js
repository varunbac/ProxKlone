const siteApi = async (path, options = {}) => {
    const response = await fetch('/api' + path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
};

const accountLink = document.querySelector('#accountLink');
if (accountLink) {
    siteApi('/me').then(({ user }) => {
        if (!user) return;
        accountLink.textContent = `Sign Out · ${user.name.split(' ')[0]}`;
        accountLink.href = '#sign-out';
        accountLink.addEventListener('click', async event => {
            event.preventDefault();
            await siteApi('/logout', { method: 'POST', body: '{}' });
            window.location.href = '/sign%20up/';
        });
    }).catch(() => {});
}

document.querySelectorAll('#klonerLink').forEach(link => link.addEventListener('click', event => event.preventDefault()));

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let activeSurface = null;
    let pendingPointer = null;
    let animationFrame = 0;

    const resetSurface = surface => {
        if (!surface) return;
        surface.style.removeProperty('transform');
        if (activeSurface === surface) activeSurface = null;
    };

    document.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        const surface = event.target.closest?.('.glass-tilt') || null;
        if (activeSurface && activeSurface !== surface) resetSurface(activeSurface);
        if (!surface) {
            pendingPointer = null;
            return;
        }

        activeSurface = surface;
        pendingPointer = { surface, x: event.clientX, y: event.clientY };
        if (animationFrame) return;
        animationFrame = requestAnimationFrame(() => {
            animationFrame = 0;
            if (!pendingPointer) return;
            const { surface: target, x, y } = pendingPointer;
            const bounds = target.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            const horizontal = Math.max(0, Math.min(1, (x - bounds.left) / bounds.width));
            const vertical = Math.max(0, Math.min(1, (y - bounds.top) / bounds.height));
            const rotateX = (0.5 - vertical) * 8;
            const rotateY = (horizontal - 0.5) * 8;
            target.style.transform = `perspective(1400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
        });
    });

    document.addEventListener('pointerout', event => {
        const surface = event.target.closest?.('.glass-tilt');
        const nextSurface = event.relatedTarget?.closest?.('.glass-tilt');
        if (!surface || surface === nextSurface || (nextSurface && surface.contains(nextSurface))) return;
        resetSurface(surface);
    });

    window.addEventListener('blur', () => {
        pendingPointer = null;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        resetSurface(activeSurface);
    });
}
