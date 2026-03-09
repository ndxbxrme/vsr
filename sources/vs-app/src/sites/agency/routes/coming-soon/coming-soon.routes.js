angular.module('vs-agency').config(function($stateProvider) {
  return $stateProvider.state('agency_coming-soon', {
    url: '/agency/coming-soon',
    template: '<agency-coming-soon></agency-coming-soon>',
    data: {
      title: 'Vitalspace Agency - Instructions Coming Soon',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})