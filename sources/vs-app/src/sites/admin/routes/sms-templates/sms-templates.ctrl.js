import './sms-templates.styl'
angular.module('vs-admin')
.directive('smsTemplates', function($http, $timeout, $state, env, alert) {
  return {
    template: require('./sms-templates.html').default,
    scope: {},
    link: (scope) => {
      const showCopied = (card) => {
        const status = card && card.querySelector('.copy-status');
        if (!status) return;
        status.classList.add('is-visible');
        $timeout(() => status.classList.remove('is-visible'), 1500);
      };
      const fallbackCopy = (text, card) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          showCopied(card);
        } finally {
          document.body.removeChild(textarea);
        }
      };
      scope.copyTemplate = (event) => {
        const button = event && event.currentTarget;
        const card = button && button.closest('.card');
        const content = card && card.querySelector('.template-content');
        if (!content) return;
        const text = content.innerText.trim();
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => showCopied(card)).catch(() => fallbackCopy(text, card));
        } else {
          fallbackCopy(text, card);
        }
      };
    }
  }
});