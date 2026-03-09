angular.module('vs-app')
.directive('mainTemplate', function($stateParams, $state) {
  return {
    scope: {},
    template: require('./template.html').default,
    link: (scope) => {
      
      var cb, fetchDefaultProp;
      scope.type = $stateParams.type;
      cb = function(template) {
        if (template) {
          return scope.template.locked = true;
        }
      };
      if ($stateParams.type === 'email') {
        scope.lang = 'pug';
        scope.template = scope.single('main:emailtemplates', $stateParams.id, cb);
      } else {
        scope.lang = 'text';
        scope.template = scope.single('main:smstemplates', $stateParams.id, cb);
      }
      scope.save = function() {
        if (scope.myForm.$valid) {
          scope.template.save();
          return $state.go('setup');
        }
      };
      scope.cancel = function() {
        return $state.go('setup');
      };
    }
  }
})
.config(($stateProvider) => $stateProvider.state('template', {
  url: '/template/:id/:type',
  template: '<main-template></main-template>',
  data: {title:'Vitalspace - Template', auth:['admin','superadmin']}
}));