package com.inknow.manusim.model;

import java.text.DecimalFormat;

/** DayTime is a class to perform several operations related with time processing.
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011.
*/

public class DayTime {
	
	private int hour;
	private int minute;
	private int dayMinute;
	
	// constructors
	
	public DayTime() {
		this.dayMinute = 0;
		this.hour = 0;
		this.minute = 0;
	}
	
	public DayTime(int dayMinute) {
		if ( dayMinute >= 0 && dayMinute < 1440 ) {
			this.dayMinute = dayMinute;
			this.hour = (int) Math.floor( dayMinute / 60 );
			this.minute = dayMinute - this.hour * 60;
		} else {
			this.dayMinute = 0;
			this.hour = 0;
			this.minute = 0;
		}
	}
	
	public DayTime(int hour, int minute) {	
		this.dayMinute = hour * 60 + minute;
		if ( this.dayMinute >= 0 && this.dayMinute < 1440 ) {
			this.hour = hour;
			this.minute = minute;
		} else {
			this.dayMinute = 0;
			this.hour = 0;
			this.minute = 0;
		}
	}
	
	// other methods
	
	public String getDayTimeString() {
		DecimalFormat fmt = new DecimalFormat( "00" );
		return fmt.format( this.hour ) + ":" + fmt.format( this.minute );
	}
	
	public void setDayTime(String dayTimeString) {
		this.hour = Integer.valueOf( dayTimeString.substring(0, 2) );
		this.minute = Integer.valueOf( dayTimeString.substring(3) );
		this.dayMinute = this.hour * 60 + this.minute;
		if ( this.dayMinute< 0 || this.dayMinute >= 1440 ) {
			 this.dayMinute = 0;
			 this.hour = 0;
			 this.minute = 0;
		}
		return;
	}
	
	public Boolean addMinutes(int minutes) {
		Boolean dayEnd = false;
		if (this.dayMinute + minutes >= 1440) {
			this.dayMinute += minutes - 1440;
			dayEnd = true;
		} else {
			this.dayMinute += minutes;
		}
		this.hour = (int) Math.floor( this.dayMinute/60 );
		this.minute = this.dayMinute - this.hour*60;
		return dayEnd;
	}
	
	public Boolean isEqual(DayTime dayTime) {
		return ( this.dayMinute == dayTime.getDayMinute() );
	}
	
	public Boolean isAfter(DayTime dayTime) {
		return ( this.dayMinute > dayTime.getDayMinute() );
	}
	
	public Boolean isBefore(DayTime dayTime) {
		return ( this.dayMinute < dayTime.getDayMinute() );
	}
	
	public Boolean isAfterOrEqual(DayTime dayTime) {
		return ( this.dayMinute >= dayTime.getDayMinute() );
	}
	
	public Boolean isBeforeOrEqual(DayTime dayTime) {
		return ( this.dayMinute <= dayTime.getDayMinute() );
	}
	
	// gets & sets

	public int getHour() {
		return this.hour;
	}

	public int getMinute() {
		return this.minute;
	}

	public int getDayMinute() {
		return this.dayMinute;
	}
	
	//--

	public void setHour(int hour) {
		if ( hour >= 0 && hour < 24 ) {
			this.hour = hour;
			this.dayMinute = hour*60 + this.minute;
		} else {
			this.hour = 0;
			this.dayMinute = this.minute;
		}
		return;
	}

	public void setMinute(int minute) {
		if (minute >= 0 && minute < 60) {
			this.minute = minute;
			this.dayMinute = this.hour * 60 + minute;
		} else {
			this.minute = 0;
			this.dayMinute = this.hour * 60;
		}
		return;
	}

	public void setDayMinute(int dayMinute) {
		if (dayMinute >= 0 && dayMinute < 1440) {
			this.dayMinute = dayMinute;
			this.hour = (int) Math.floor( dayMinute/60 );
			this.minute = dayMinute - this.hour * 60;
		} else {
			this.dayMinute = 0;
			this.hour = 0;
			this.minute = 0;
		}
		return;
	}
	
}
