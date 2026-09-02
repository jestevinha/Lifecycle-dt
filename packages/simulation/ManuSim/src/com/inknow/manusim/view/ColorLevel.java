package com.inknow.manusim.view;

import java.awt.Color;

import com.inknow.manusim.model.DayTime;

/** ColorLevel is an abstract class to define light levels during the day cycle. 
*
* @author Rui Neves-Silva
* @version 1.0 Build 0001 Nov-2011.
*/

public abstract class ColorLevel {
	
	public static Color getWallColor() {	
		int r = (int) Math.ceil(255);
		int g = (int) Math.ceil(255);
		int b = (int) Math.ceil(255);
		return new Color(r, g ,b);
	}
	
	public static Color getWallColorFactor(DayTime dayTime, double skyExposure) {
		double skyLightLevel = Math.max( Math.cos( Math.PI * ( dayTime.getDayMinute() - 840) / 1080) * skyExposure, 0);
		int r = (int) Math.ceil( skyLightLevel * 230 + 25 );
		int g = (int) Math.ceil( skyLightLevel * 230 + 25 );
		int b = (int) Math.ceil( skyLightLevel * 230 + 25 );
		return new Color( r, g ,b );
	}
	
	public static double getNaturalLightLevel(DayTime dayTime, double skyExposure) {
		return (Math.max( Math.cos( Math.PI * ( dayTime.getDayMinute() - 840) / 1080 ) * skyExposure, 0) );
	}
	
	public static Color getDisplaySky(DayTime dayTime) {
		int auxMin = dayTime.getDayMinute();
		if ( auxMin > 480 && auxMin < 1200 ) {
			return new Color( 64, 64, 64 );
		} else {
			return new Color( 192, 192, 192 );
		}
	}
	
	public static Color getSkyColor(DayTime dayTime) {
		double lightLevel = Math.max( Math.cos(Math.PI*(dayTime.getDayMinute() - 840) / 1080) , 0);
		int r = (int) Math.ceil( lightLevel * 213 + 15 );
		int g = (int) Math.ceil( lightLevel * 202 + 35 );
		int b = (int) Math.ceil( lightLevel * 186 + 62 );
		return new Color( r, g, b );
	}
	
	public static Color getSkyColor(int lightLevel) {	
		switch (lightLevel) {
			case 0: return new Color( 15,  35,  62 );
			case 1: return new Color( 36,  55,  81 );
			case 2: return new Color( 58,  75,  99 );
			case 3: return new Color( 79,  96,  118 );
			case 4: return new Color( 100, 116, 136 );
			case 5: return new Color( 122, 136, 155 );
			case 6: return new Color( 143, 156, 174 );
			case 7: return new Color( 164, 176, 192 );
			case 8: return new Color( 185, 197, 211 );
			case 9: return new Color( 207, 217, 229 );
			case 10: return new Color( 228, 237, 248 );
			default: return new Color( 228, 237, 248 );	
		}
	}
	
} // EOF
