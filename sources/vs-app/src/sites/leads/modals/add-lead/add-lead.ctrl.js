angular.module('vs-leads').controller('addLeadModalCtrl', function($scope, $state, $http, data, ndxModalInstance) {
  $scope.selection = {
    selectedProperty: data.selectedProperty || null
  };
  $scope.disabled = false;
  $scope.submitted = false;
  $scope.forms = {};
  
  // Get property API URL from $http.sites
  const propertyUrl = $http.sites && $http.sites.main ? $http.sites.main.url.replace('/app', '/property/api') : 'https://server.vitalspace.co.uk/property/api';
  
  // Initialize lead - either new or editing existing
  if (data.lead) {
    // Editing existing lead
    $scope.lead = data.lead;
    // Set the selected property if editing
    if (data.lead.item && data.lead.item.roleId) {
      $scope.selection.selectedProperty = data.lead.item.roleId;
    }
  } else {
    // Creating new lead
    $scope.lead = $scope.single('leads:leads', {}, function(lead) {
      lead.item = {
        roleType: data.roleType || 'Selling',
        source: 'local',
        user: {}
      };
    });
  }
  
  $scope.sources = {
    items: [
      { name: 'Email', _id: 'email' },
      { name: 'Telephone', _id: 'telephone' },
      { name: 'Walk In', _id: 'walkin' },
      { name: 'OnTheMarket', _id: 'onthemarket' }
    ]
  };
  
  // Get selling properties
  $scope.selling = $scope.list({
    route: `${propertyUrl}/search`
  }, {
    where: {
      RoleType: 'Selling',
      IncludeStc: true
    },
    transform: {
      items: 'Collection',
      total: 'TotalCount'
    }
  }, function(properties) {
    properties.items.forEach(property => {
      property.name = property.displayAddress;
      property._id = property.RoleId;
    });
  });
  
  // Get letting properties
  $scope.letting = $scope.list({
    route: `${propertyUrl}/search`
  }, {
    where: {
      RoleType: 'Letting',
      IncludeStc: true
    },
    transform: {
      items: 'Collection',
      total: 'TotalCount'
    }
  }, function(properties) {
    properties.items.forEach(property => {
      property.name = property.displayAddress;
      property._id = property.RoleId;
    });
  });
  
  $scope.save = function() {
    $scope.submitted = true;
    
    if (!$scope.forms.myForm || !$scope.forms.myForm.$valid) {
      return;
    }
    
    // Only enforce property selection for new leads (not when editing)
    if ($scope.lead.item.roleType !== 'Valuation' && !$scope.selection.selectedProperty && !$scope.lead.item._id) {
      alert('Please select a property from the list');
      return;
    }
    
    if ($scope.selection.selectedProperty && $scope.lead.item.roleType !== 'Valuation') {
      const propertyList = $scope.lead.item.roleType === 'Selling' ? $scope.selling.items : $scope.letting.items;
      const selectedProp = propertyList.find(p => p._id == $scope.selection.selectedProperty);
      
      if (selectedProp) {
        $scope.lead.item.property = {
          address: selectedProp.displayAddress || (selectedProp.AddressNumber + ' ' + selectedProp.Address1),
          postcode: selectedProp.Postcode || (selectedProp.Address && selectedProp.Address.Postcode)
        };
        $scope.lead.item.price = selectedProp.Price && selectedProp.Price.PriceValue ? selectedProp.Price.PriceValue : selectedProp.Price;
        $scope.lead.item.propertyId = selectedProp.PropertyId;
        $scope.lead.item.roleId = selectedProp.RoleId;
      }
    }
    
    if ($scope.lead.item.roleType === 'Valuation') {
      $scope.lead.item.property = {
        address: $scope.lead.item.user.address || '',
        postcode: $scope.lead.item.user.postcode || ''
      };
    }
    
    $scope.lead.item.date = new Date();
    $scope.lead.item.applicant = `${$scope.lead.item.user.title} ${$scope.lead.item.user.first_name} ${$scope.lead.item.user.last_name}`;
    
    $scope.lead.save().then(() => {
      ndxModalInstance.close($scope.lead.item);
    });
  };
  
  $scope.cancel = function() {
    ndxModalInstance.dismiss();
  };
});
