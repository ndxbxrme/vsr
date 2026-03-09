angular.module('vs-lettings').config(function($stateProvider) {
  return $stateProvider.state('lettings_coming-soon', {
    url: '/lettings/coming-soon',
    template: '<lettings-coming-soon></lettings-coming-soon>',
    data: {
      title: 'Vitalspace Lettings - Instructions Coming Soon',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})