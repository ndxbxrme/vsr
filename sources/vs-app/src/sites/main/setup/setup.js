angular.module('vs-app')
.directive('mainSetup', function() {
  return {
    scope: {},
    template: require('./setup.html').default,
    link: (scope) => {
      scope.emailTemplates = scope.list('main:emailtemplates');
    }
  }
})
.config(($stateProvider) => $stateProvider.state('main_setup', {
  url: '/setup',
  template: '<main-setup></main-setup>',
  data: {title:'Vitalspace App - Setup', auth:['admin','superadmin']}
}));