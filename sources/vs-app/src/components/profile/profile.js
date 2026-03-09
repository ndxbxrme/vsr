angular.module('vs-app')
.directive('profile', function($http, $stateParams) {
  return {
    template: require('./profile.html').default,
    scope: {},
    link: function(scope, elem) {
      const id = $stateParams.id || scope.auth.getUser()._id;
      scope.user = scope.single('main:users', id);
      scope.submit = () => {
        scope.user.save();
      };
    }
  }
})
.config(($stateProvider) => {
  $stateProvider.state('profile', {
    url: '/profile',
    template: '<profile></profile>',
    data: {title: 'Profile'}
  });
  $stateProvider.state('profile-id', {
    url: '/profile/:id',
    template: '<profile></profile>',
    data: {title: 'Profile',auth:['superadmin']}
  });
});