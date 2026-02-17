import { WorkHourRegister, WorkHourFilters } from "@pontalti/types/work-hour.types";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { startAndEndOfDate } from "@pontalti/utils/helper";

const createEmployeeWorkHour = async (data: WorkHourRegister) => {
  try{
    return await prisma.workHours.create({ data, include: { employee: true } });
  } catch(e) {
    console.log(e)
    dbErrorHandle(e)
  }
};

const getEmployeeWorkHour = async (id: number) => {
  try{
    return await prisma.workHours.findUnique({ where: { id } });
  } catch(e) {
    dbErrorHandle(e)
  }
};

const getEmployeesWorkHours = async (filters: WorkHourFilters) => {
  try{
    const {
      employee_id,
      startDate,
      endDate
    } = filters

    const selectedFields = {
      id: true,
      clock_in: true,
      clock_out: true,
    }

    const whereClause = {
      employee_id: employee_id,
      clock_in: { gte: startAndEndOfDate(startDate).startOfDay, lte: startAndEndOfDate(endDate).endOfDay }
    };


    const workHours = await prisma.workHours.findMany({
      where: whereClause,
      select: selectedFields,
      orderBy: {
        created_at: 'asc'
      }
    })

    return workHours
  } catch(e) {
    console.log(e)
    dbErrorHandle(e)
  }
};


const getTodayEmployeeWorkHour = async (employee_id: number) => {
  try{
    console.log(10)
    const startDate = startAndEndOfDate(new Date()).startOfDay;
    console.log(1.2)
    return await prisma.workHours.findMany({ 
      where: { employee_id: employee_id, created_at: { gte: startDate } },
      orderBy: { created_at: 'desc' } 
    });
  } catch(e) {
    dbErrorHandle(e)
  }
};

const getTodayWorkHour = async () => {
  try {
    const startDate = startAndEndOfDate(new Date()).startOfDay;
    return await prisma.workHours.findMany({ 
      where: { clock_in: { gte: startDate } },
      orderBy: { clock_in: 'desc' },
      include: { employee: true },
      distinct: ['employee_id'],
    });
  } catch(e) {
    dbErrorHandle(e)
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialEmployeeWorkHour = async (id: number, data: any) => {
  const existingEmployeeWorkHour = await prisma.workHours.findUnique({
    where: { id }
  });

  if (!existingEmployeeWorkHour) {
    throw new Error("Employee Work Hour not found");
  }
  console.log(2.2)

  const updatedEmployee = await prisma.workHours.update({
    where: { id },
    data: {
      ...existingEmployeeWorkHour,
      ...data,
      updated_at: new Date()
    }
  });
  console.log(2.3)

  return updatedEmployee;
};

const deleteEmployeeWorkHour = async (id: number) => {
  return await prisma.workHours.delete({ where: { id } });
};

const getWorkHoursReport = async (startDate: Date, endDate: Date, employeeId?: number) => {
  try {
    const whereClause: any = {
      clock_in: {
        gte: startAndEndOfDate(startDate).startOfDay,
        lte: startAndEndOfDate(endDate).endOfDay
      }
    };

    if (employeeId) {
      whereClause.employee_id = employeeId;
    }

    return await prisma.workHours.findMany({
      where: whereClause,
      include: { employee: true },
      orderBy: [
        { clock_in: 'desc' }
      ]
    });
  } catch (e) {
    console.log(e);
    dbErrorHandle(e);
  }
};

export default {
  createEmployeeWorkHour,
  getEmployeeWorkHour,
  getEmployeesWorkHours,
  getTodayEmployeeWorkHour,
  getTodayWorkHour,
  updatePartialEmployeeWorkHour,
  deleteEmployeeWorkHour,
  getWorkHoursReport
};
