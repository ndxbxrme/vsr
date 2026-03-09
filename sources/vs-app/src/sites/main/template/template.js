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
          scope.myForm.$setPristine();
          return $state.go('main_setup');
        }
      };
      scope.cancel = function() {
        return $state.go('main_setup');
      };
    }
  }
})
.config(($stateProvider) => $stateProvider.state('template', {
  url: '/template/:id/:type',
  template: '<main-template></main-template>',
  data: {title:'Vitalspace App - Template', auth:['admin','superadmin']}
}));