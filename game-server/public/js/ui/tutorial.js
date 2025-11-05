/**
 * Tutorial System
 * Manages the first-time user tutorial overlay
 */

const TUTORIAL_STORAGE_KEY = 'gameHub_tutorialCompleted';
const TUTORIAL_TOTAL_STEPS = 5;

export function createTutorialManager() {
    const overlay = document.getElementById('tutorial-overlay');
    const nextBtn = document.getElementById('tutorial-next');
    const skipBtn = document.getElementById('tutorial-skip');
    const stepIndicator = document.getElementById('tutorial-step-indicator');
    const steps = document.querySelectorAll('.tutorial-step');

    let currentStep = 0;

    function showStep(stepIndex) {
        // Hide all steps
        steps.forEach(step => step.classList.add('hidden'));

        // Show current step
        if (steps[stepIndex]) {
            steps[stepIndex].classList.remove('hidden');
        }

        // Update step indicator
        stepIndicator.textContent = `${stepIndex + 1} / ${TUTORIAL_TOTAL_STEPS}`;

        // Update button text for last step
        if (stepIndex === TUTORIAL_TOTAL_STEPS - 1) {
            nextBtn.textContent = 'Get Started!';
        } else {
            nextBtn.textContent = 'Next';
        }

        currentStep = stepIndex;
    }

    function nextStep() {
        if (currentStep < TUTORIAL_TOTAL_STEPS - 1) {
            showStep(currentStep + 1);
        } else {
            completeTutorial();
        }
    }

    function completeTutorial() {
        overlay.classList.add('hidden');
        localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');

        // Show a welcome toast
        if (window.toastManager) {
            window.toastManager.show('Tutorial complete! Enjoy your games! 🎮', 'success');
        }
    }

    function skipTutorial() {
        if (confirm('Are you sure you want to skip the tutorial? You can always explore on your own!')) {
            completeTutorial();
        }
    }

    function shouldShowTutorial() {
        const completed = localStorage.getItem(TUTORIAL_STORAGE_KEY);
        return completed !== 'true';
    }

    function showTutorial() {
        overlay.classList.remove('hidden');
        showStep(0);
    }

    function resetTutorial() {
        localStorage.removeItem(TUTORIAL_STORAGE_KEY);
        currentStep = 0;
        showStep(0);
    }

    // Event listeners
    nextBtn.addEventListener('click', nextStep);
    skipBtn.addEventListener('click', skipTutorial);

    // Keyboard navigation
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            skipTutorial();
        } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
            nextStep();
        }
    });

    // Auto-show tutorial on first visit
    if (shouldShowTutorial()) {
        // Delay showing tutorial slightly to let the page load
        setTimeout(() => {
            showTutorial();
        }, 500);
    }

    return {
        show: showTutorial,
        hide: completeTutorial,
        reset: resetTutorial,
        shouldShow: shouldShowTutorial
    };
}

// Export a manual trigger function for testing/debugging
export function showTutorial() {
    const tutorial = createTutorialManager();
    tutorial.show();
}
