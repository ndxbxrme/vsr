angular.module('vs-app')
.directive('profile', function($http, $stateParams, alert) {
  return {
    template: require('./profile.html').default,
    scope: {},
    link: function(scope, elem) {
      const id = $stateParams.id || scope.auth.getUser()._id;
      scope.user = scope.single('main:users', id);
      scope.submit = () => {
        scope.user.save();
        alert.log('Profile updated');
      };
    }
  }
})
.config(($stateProvider) => {
  $stateProvider.state('main_profile', {
    url: '/profile',
    template: '<profile></profile>',
    data: {title: 'Vitalspace App - Profile'}
  });
  $stateProvider.state('main_profile-id', {
    url: '/profile/:id',
    template: '<profile></profile>',
    data: {title: 'Vitalspace App - Profile',auth:['superadmin']}
  });
});