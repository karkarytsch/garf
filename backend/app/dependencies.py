from app.services.data_views import DataViewService
from app.services.datasets import DatasetService
from app.services.statistics import DescriptiveStatisticsService
from app.services.variables import VariableService
from app.storage.datasets import DatasetRepository


# local storage is shared by all request handlers in this process
repository = DatasetRepository()
dataset_service = DatasetService(repository)
variable_service = VariableService(repository)
data_view_service = DataViewService(repository)
descriptive_statistics_service = DescriptiveStatisticsService(repository)


def get_dataset_service() -> DatasetService:
    return dataset_service


def get_variable_service() -> VariableService:
    return variable_service


def get_data_view_service() -> DataViewService:
    return data_view_service


def get_descriptive_statistics_service() -> DescriptiveStatisticsService:
    return descriptive_statistics_service
