angular.module('vs-app')
.controller('mainDashboardCtrl', function($scope, Auth, $filter, $timeout, ndxCheck, env, $http, $stateParams) {
  $scope.thing = 'hiya';
  $scope.unknownSolicitors = [];
  $scope.env = env;
  $scope.salesGraphLoading = true;
  $scope.lettingsGraphLoading = true;
  
  if (ndxCheck && ndxCheck.setPristine) {
    ndxCheck.setPristine($scope);
  }
  
  $scope.$on('$destroy', function() {
    if (ndxCheck && ndxCheck.setPristine) {
      ndxCheck.setPristine($scope);
    }
  });
  
  const hasAgencyAccess = Auth.isAuthorized('agency_dashboard');
  const hasLettingsAccess = Auth.isAuthorized('lettings_dashboard');
  const hasBothAccess = hasAgencyAccess && hasLettingsAccess;
  
  $scope.hasAgencyAccess = hasAgencyAccess;
  $scope.hasLettingsAccess = hasLettingsAccess;
  $scope.hasBothAccess = hasBothAccess;
  
  // Set initial active view based on URL parameter or permissions
  if ($stateParams.view === 'lettings' && hasLettingsAccess) {
    $scope.activeView = 'lettings';
  } else if ($stateParams.view === 'sales' && hasAgencyAccess) {
    $scope.activeView = 'sales';
  } else if (hasBothAccess) {
    $scope.activeView = 'sales'; // Default to sales if user has both
  } else if (hasAgencyAccess) {
    $scope.activeView = 'sales';
  } else if (hasLettingsAccess) {
    $scope.activeView = 'lettings';
  }
  
  $scope.setActiveView = function(view) {
    $scope.activeView = view;
  };
  
  // Fetch sales leads total (for agency users)
  if (hasAgencyAccess) {
    $scope.salesComingSoon = $scope.list('leads:instructions', {
      where: {
        completed: null
      },
      page: 1,
      pageSize: 10
    }, function(instructions) {
      if (instructions && instructions.items) {
        const now = new Date();
        const seventyTwoHoursFromNow = new Date(now.getTime() + (72 * 60 * 60 * 1000));
        
        instructions.items.forEach(item => {
          if(item.insertedOn) item.insertedOn = new Date(item.insertedOn);
          if(item.goLiveDate) item.goLiveDate = new Date(item.goLiveDate);
          if(item.dateOfPhotos) item.dateOfPhotos = new Date(item.dateOfPhotos);
        });
        
        // Filter to only show items with photos due in past or next 72 hours
        $scope.salesComingSoonFiltered = instructions.items.filter(item => {
          if (!item.dateOfPhotos) return false;
          return item.dateOfPhotos <= seventyTwoHoursFromNow;
        }).sort((a, b) => a.dateOfPhotos - b.dateOfPhotos);
        $scope.salesComingSoonFilteredCount = $scope.salesComingSoonFiltered.length;
      }
    });
    
    $scope.salesLeads = $scope.list('leads:leads', {
      where: {
        roleType: 'Selling',
        booked: null
      },
      page: 1,
      pageSize: 0
    });
    
    $scope.valuationLeads = $scope.list('leads:leads', {
      where: {
        roleType: 'Valuation',
        booked: null
      },
      page: 1,
      pageSize: 0
    });
    
    $scope.offers = $scope.list('leads:offers', {
      where: {
        actioned: null
      },
      sort: 'date',
      sortDir: 'DESC',
      page: 1,
      pageSize: 10
    });
  }

  if (hasLettingsAccess) {
    $scope.lettingLeads = $scope.list('leads:leads', {
      where: {
        roleType: 'Letting',
        booked: null
      },
      page: 1,
      pageSize: 0
    });
    
    $scope.lettingValuationLeads = $scope.list('leads:leads', {
      where: {
        roleType: 'Valuation',
        booked: null
      },
      page: 1,
      pageSize: 0
    });
    
    $scope.availableProperties = $scope.list({
      route: `${$scope.env.PROPERTY_URL}/search`
    }, {
      where: {
        RoleStatus: 'InstructionToLet',
        RoleType: 'Letting',
        IncludeStc: true
      },
      transform: {
        items: 'Collection',
        total: 'TotalCount'
      }
    });
    
    $scope.agreedLets = $scope.list('lettings:properties', {
      where: {
        Status: 'OfferAccepted',
        delisted: false
      },
      page: 1,
      pageSize: 0
    });
    
    $scope.comingSoon = $scope.list('lettings:marketing', {
      where: {
        completed: null
      },
      page: 1,
      pageSize: 10
    });
    
    $scope.lettingOffers = $scope.list('leads:offerslettings', {
      where: {
        actioned: null
      },
      sort: 'date',
      sortDir: 'DESC',
      page: 1,
      pageSize: 10
    });
    
    $scope.nextMoveInFiltered = [];
    $scope.nextMoveIn = $scope.list('lettings:properties', {
      where: {
        Status: 'OfferAccepted',
        delisted: false
      },
      sort: 'proposedMoving',
      sortDir: 'ASC',
      page: 1,
      pageSize: 50
    }, function(properties) {
      const now = new Date();
      const twentyFourHoursFromNow = new Date(now.getTime() + (24 * 60 * 60 * 1000));
      
      $scope.nextMoveInFiltered = [];
      if (properties && properties.items) {
        properties.items.forEach(property => {
          if (property.proposedMoving) {
            const moveInDate = new Date(property.proposedMoving);
            if (moveInDate <= twentyFourHoursFromNow) {
              $scope.nextMoveInFiltered.push(property);
            }
          }
        });
      }
    });
  }
  
  const currentUser = Auth.getUser();
  $scope.myPipeline = 0;
  $scope.myInstructedBy = 0;
  $scope.myLettingsPipeline = 0;
  $scope.myPipelineProperties = [];
  $scope.myInstructedByProperties = [];
  
  if (currentUser) {
    $scope.consultants = $scope.list('main:users', null, (users) => {
      const currentUserEmail = currentUser.local.email;
      const consultant = users.items.find(user => user.local.email === currentUserEmail);
      
      if (!consultant) {
        return;
      }
      
      const userId = consultant._id;
      
      if (hasAgencyAccess) {
        function calculateInstructedBy() {
          let instructedByCount = 0;
          const instructedByProperties = [];
          if (!($scope.propertyadmin && $scope.propertyadmin.items && 
                $scope.properties && $scope.properties.items && 
                $scope.clientmanagement && $scope.clientmanagement.items)) {
            $scope.myInstructedBy = instructedByCount;
            $scope.myInstructedByProperties = instructedByProperties;
            return;
          }
      
          const allProperties = [...$scope.properties.items, ...$scope.clientmanagement.items];
          
          for (let i = 0; i < $scope.propertyadmin.items.length; i++) {
            const propertyadminitem = $scope.propertyadmin.items[i];
            if (!propertyadminitem.RoleId || !propertyadminitem.instructionToMarket || !propertyadminitem.instructionToMarket.instructedBy) continue;
            if (propertyadminitem.instructionToMarket.instructedBy !== userId) continue;
            const property = allProperties.find(p => p.roleId === propertyadminitem.RoleId.toString());
            if (!property || property.override && property.override.deleted) continue;
      
            instructedByCount++;
            instructedByProperties.push(property);
          }
          
          $scope.myInstructedBy = instructedByCount;
          $scope.myInstructedByProperties = instructedByProperties;
        }
        
        $scope.propertyadmin = $scope.list('main:propertyadmin', null, function(propertyadminList) {
          calculateInstructedBy();
        });
        
        $scope.clientmanagement = $scope.list('agency:clientmanagement', {
          where: {
            active: true
          }
        }, function(properties) {
          properties.items.forEach(property => {
            property.roleId = property.RoleId.toString();
            property.type = 'clientmanagement';
          });
          calculateInstructedBy();
        });
        
        $scope.properties = $scope.list('agency:properties', {
          where: { 
            modifiedAt: { $gt: new Date('2022-12-20').valueOf() }
          },
          transformer: 'dashboard/properties'
        }, function(properties) {
          let count = 0;
          $scope.unknownSolicitors = [];
          $scope.myPipelineProperties = [];
          if (properties && properties.items) {
            let i = properties.items.length;
            while (i-- > 0) {
              const property = properties.items[i];
              if (property.override && property.override.deleted) {
                properties.items.splice(i, 1);
                continue;
              }
              if (!property.role) {
                continue;
              }
              if (property.role.RoleStatus.SystemName !== 'OfferAccepted') {
                continue;
              }
              if (Object.values(property.milestoneIndex)[0] === 10) {
                continue;
              }
              // Check if property is stale (more than 1 year old)
              const stale = new Date(property.role.CreatedDate) < (new Date() - (365 * 24 * 60 * 60 * 1000));
              if (stale) {
                continue;
              }
              // Check for unknown solicitors
              const missingPurchaser = !property.purchasersSolicitor || !Object.keys(property.purchasersSolicitor).length;
              const missingVendor = !property.vendorsSolicitor || !Object.keys(property.vendorsSolicitor).length;
              if (missingPurchaser || missingVendor) {
                const solRecord = {
                  _id: property._id,
                  roleId: property.role.SalesRoleId,
                  address: property.displayAddress,
                  p: missingPurchaser,
                  v: missingVendor
                };
                $scope.unknownSolicitors.push(solRecord);
              }
              // Match by consultant ID
              if (property.consultant === userId) {
                count++;
                $scope.myPipelineProperties.push(property);
              }
            }
          }
          $scope.myPipeline = count;
          calculateInstructedBy();
        });
      }
      
      if (!hasAgencyAccess && hasLettingsAccess) {
        $scope.lettingsProperties = $scope.list('lettings:properties', {
          where: {
            Status: 'OfferAccepted',
            delisted: false
          }
        }, function(properties) {
          let count = 0;
          if (properties && properties.items) {
            for (let i = 0; i < properties.items.length; i++) {
              const property = properties.items[i];
              if (property.override && property.override.deleted === true) {
                continue;
              }
              // Check if property is stale (more than 1 year old)
              if (property.role && property.role.CreatedDate) {
                const stale = new Date(property.role.CreatedDate) < (new Date() - (365 * 24 * 60 * 60 * 1000));
                if (stale) {
                  continue;
                }
              }
              // Match by consultant ID
              if (property.consultant === userId) {
                count++;
              }
            }
          }
          $scope.myLettingsPipeline = count;
        });
      }
    });
  }
  
  $scope.formatAddress = (address) => {
    if(!address) return '';
    return address.replace(/, ,/g, ',');
  }
  
  $scope.showMyPipelineModal = function() {
    if ($scope.myPipelineProperties && $scope.myPipelineProperties.length) {
      return $scope.modal({
        template: require('../../agency/modals/dashboard-income/dashboard-income.html').default,
        controller: 'agencyDashboardIncomeCtrl',
        data: {
          di: {
            name: 'My Pipeline Properties'
          },
          month: '',
          list: $scope.myPipelineProperties
        }
      });
    }
  };
  
  $scope.showMyInstructedByModal = function() {
    if ($scope.myInstructedByProperties && $scope.myInstructedByProperties.length) {
      return $scope.modal({
        template: require('../../agency/modals/dashboard-income/dashboard-income.html').default,
        controller: 'agencyDashboardIncomeCtrl',
        data: {
          di: {
            name: 'Properties Instructed By Me'
          },
          month: '',
          list: $scope.myInstructedByProperties
        }
      });
    }
  };
  
  $scope.getGreeting = function() {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Good Morning';
    } else if (hour < 18) {
      return 'Good Afternoon';
    } else {
      return 'Good Evening';
    }
  };
  
  $scope.getFirstName = function() {
    if (currentUser && currentUser.local && currentUser.displayName) {
      return currentUser.displayName.split(' ')[0];
    }
    return 'There';
  };
  
  $scope.getFormattedDate = function() {
    const date = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    // Add ordinal suffix
    let suffix = 'th';
    if (day === 1 || day === 21 || day === 31) suffix = 'st';
    else if (day === 2 || day === 22) suffix = 'nd';
    else if (day === 3 || day === 23) suffix = 'rd';
    
    return `${dayName}, ${day}${suffix} ${month} ${year}`;
  };

  // Sales chart data - current year only
  $scope.chartData = [];
  $scope.lettingsChartData = [];
  
  function initializeChart() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const months = [];
    
    // Generate all 12 months of current year
    for (let i = 0; i < 12; i++) {
      const date = new Date(currentYear, i, 1);
      months.push({
        date: date,
        month: $filter('date')(date, 'MMM'),
        startDate: date.valueOf(),
        endDate: new Date(date.getFullYear(), date.getMonth() + 1, 0).valueOf(),
        actual: 0,
        target: 0
      });
    }
    
    if (hasAgencyAccess) {
      $scope.chartData = months;
      let salesTargetsLoaded = false;
      let salesPropertiesLoaded = false;
      let salesChartRendered = false;
      
      function renderSalesChartIfReady() {
        if (salesTargetsLoaded && salesPropertiesLoaded && !salesChartRendered) {
          salesChartRendered = true;
          $scope.salesGraphLoading = false;
          renderChart('sales-graph', $scope.chartData, 'Reality Sales', 'Target Sales');
        }
      }
      
      // Fetch targets - process once
      const salesTargetsList = $scope.list('agency:targets', {
        where: {
          type: 'salesAgreed'
        }
      });
      
      // Watch for initial load only
      const unwatchTargets = $scope.$watch(() => salesTargetsList.items, function(items) {
        if (items && items.length >= 0) {
          items.forEach(target => {
            const targetMonth = $scope.chartData.find(m => 
              new Date(target.date).getMonth() === new Date(m.startDate).getMonth() &&
              new Date(target.date).getFullYear() === new Date(m.startDate).getFullYear()
            );
            if (targetMonth) {
              targetMonth.target = target.value || 0;
            }
          });
          salesTargetsLoaded = true;
          renderSalesChartIfReady();
          unwatchTargets(); // Stop watching after first load
        }
      });
      
      const yearStart = new Date(currentYear, 0, 1).valueOf();
      const salesPropertiesList = $scope.list('agency:properties', {
        where: {
          startDate: {
            $gt: yearStart
          }
        }
      });
      
      // Watch for initial load only
      const unwatchProperties = $scope.$watch(() => salesPropertiesList.items, function(items) {
        if (items && items.length >= 0) {
          $scope.chartData.forEach(m => m.actual = 0);
          
          items.forEach(property => {
            if (property.override && property.override.deleted) return;
            if (!property.startDate) return;
            
            const propertyDate = new Date(property.startDate);
            const month = $scope.chartData.find(m => 
              propertyDate >= new Date(m.startDate) && propertyDate <= new Date(m.endDate)
            );
            
            if (month) {
              month.actual++;
            }
          });
          
          salesPropertiesLoaded = true;
          renderSalesChartIfReady();
          unwatchProperties(); // Stop watching after first load
        }
      });
    }
    
    if (hasLettingsAccess) {
      $scope.lettingsChartData = JSON.parse(JSON.stringify(months));
      let lettingsTargetsLoaded = false;
      let lettingsAgreedLoaded = false;
      let lettingsChartRendered = false;
      
      function renderLettingsChartIfReady() {
        if (lettingsTargetsLoaded && lettingsAgreedLoaded && !lettingsChartRendered) {
          lettingsChartRendered = true;
          $scope.lettingsGraphLoading = false;
          renderChart('lettings-graph', $scope.lettingsChartData, 'Reality Lets', 'Target Lets');
        }
      }
      
      const lettingsTargetsList = $scope.list('lettings:targets', {
        where: {
          type: 'letAgreed'
        }
      });
      
      // Watch for initial load only
      const unwatchLettingsTargets = $scope.$watch(() => lettingsTargetsList.items, function(items) {
        if (items && items.length >= 0) {
          items.forEach(target => {
            const targetMonth = $scope.lettingsChartData.find(m => 
              new Date(target.date).getMonth() === new Date(m.startDate).getMonth() &&
              new Date(target.date).getFullYear() === new Date(m.startDate).getFullYear()
            );
            if (targetMonth) {
              targetMonth.target = target.value || 0;
            }
          });
          lettingsTargetsLoaded = true;
          renderLettingsChartIfReady();
          unwatchLettingsTargets(); // Stop watching after first load
        }
      });
      
      const yearStart = new Date(currentYear, 0, 1).valueOf();
      const yearEnd = new Date(currentYear + 1, 0, 1).valueOf();
      
      $http.post($http.sites["lettings"].url + "/api/agreed/search", {
        startDate: yearStart,
        endDate: yearEnd
      }, $http.sites["lettings"].config).then(function(res) {
        $scope.lettingsChartData.forEach(m => m.actual = 0);
        
        let yearToDateTotal = 0;
        
        if (res.data && res.data.length) {
          res.data.forEach(month => {
            const monthDate = new Date(month.date);
            const chartMonth = $scope.lettingsChartData.find(m => {
              const chartDate = new Date(m.startDate);
              return chartDate.getFullYear() === monthDate.getFullYear() && 
                     chartDate.getMonth() === monthDate.getMonth();
            });
            
            if (chartMonth && month.properties) {
              chartMonth.actual = month.properties.length;
              yearToDateTotal += month.properties.length;
            }
          });
        }
        
        lettingsAgreedLoaded = true;
        $scope.$applyAsync(function() {
          renderLettingsChartIfReady();
        });
      });
    }
  }
  
  function renderChart(containerId, chartData, actualLabel, targetLabel) {
    if (!chartData.length) return;
    
    $timeout(function() {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      container.innerHTML = '';
      
      const maxValue = Math.max(
        ...(chartData.map(d => Math.max(d.actual, d.target))),
        1
      );
      
      // Create chart
      const chartHTML = `
        <div class="chart-bars">
          ${chartData.map(month => {
            const targetHeight = (month.target / maxValue) * 100;
            const actualHeight = (month.actual / maxValue) * 100;
            return `
            <div class="bar-group">
              <div class="bars">
                <div class="bar bar-actual" style="height: ${actualHeight}%">
                  <span class="bar-value ${actualHeight < 30 ? 'bar-value-small' : ''}">${month.actual}</span>
                </div>
                <div class="bar bar-target" style="height: ${targetHeight}%">
                  <span class="bar-value ${targetHeight < 30 ? 'bar-value-small' : ''}">${month.target}</span>
                </div>
              </div>
              <div class="bar-label">${month.month}</div>
            </div>
          `;
          }).join('')}
        </div>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color legend-actual"></span>
            <span class="legend-label">${actualLabel}</span>
            <span class="legend-value">${chartData.reduce((sum, m) => sum + m.actual, 0)}</span>
          </div>
          <div class="legend-item">
            <span class="legend-color legend-target"></span>
            <span class="legend-label">${targetLabel}</span>
            <span class="legend-value">${chartData.reduce((sum, m) => sum + (+m.target || 0), 0)}</span>
          </div>
        </div>
      `;
      
      container.innerHTML = chartHTML;
      
      // Trigger animation
      $timeout(() => {
        const bars = container.querySelectorAll('.bar');
        bars.forEach((bar, index) => {
          bar.style.animationDelay = `${index * 0.1}s`;
          bar.classList.add('animate');
        });
      }, 50);
    });
  }
  
  initializeChart();
})
.config(($stateProvider) => $stateProvider.state('dashboard', {
  url: '/?view',
  params: {
    view: {
      value: null,
      squash: true
    }
  },
  template: require('./dashboard.html').default,
  controller: 'mainDashboardCtrl',
  data: {title:'Vitalspace App - Dashboard'}
}));