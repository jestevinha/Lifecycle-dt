package com.inknow.manusim.setup;

import java.awt.Color;
import java.awt.Font;


import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.util.Vector;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.ControlFrame;
import com.inknow.manusim.model.Expertise;
import com.inknow.manusim.model.ExponentialModel;

public class SetupActors extends JPanel implements ActionListener { 	
	private static final long serialVersionUID = 1L;
	//
	private ControlFrame parent;
	//
	private Vector<Expertise> expertiseStdModels = new Vector<Expertise>(); // Expertise standard models for actors and Units B
	private Vector<ExponentialModel> exponentialUpStdModels = new Vector<ExponentialModel>();
	private Vector<ExponentialModel> exponentialDecayStdModels = new Vector<ExponentialModel>();
	//
	private Vector<Expertise> actorsExpertModels = new Vector<Expertise>(); // One expertise model per each of 4 groups of actors
	private ExponentialModel actorSafetyExpertiseModel = new ExponentialModel();
	private ExponentialModel actorSafetyLightModel = new ExponentialModel();
	private ExponentialModel actorSafetyShifttimeModel = new ExponentialModel();
	private ExponentialModel actorSafetyRateModel = new ExponentialModel();
	//	
	private JLabel[][]  expertBarLabel  = new JLabel[ Const.N_ACTOR_TYPES ][ Const.N_EXPERTISE_TOPICS ];
	private JButton[][] expertIncButton = new JButton[ Const.N_ACTOR_TYPES ][ Const.N_EXPERTISE_TOPICS ];
	private JButton[][] expertDecButton = new JButton[ Const.N_ACTOR_TYPES ][ Const.N_EXPERTISE_TOPICS ];
	//
	private JButton safetyExpertiseButton = new JButton();
	private JButton safetyLightButton = new JButton();
	private JButton safetyShifttimeButton = new JButton();
	private JButton safetyRateButton = new JButton();
	
	// constructors
	
	public SetupActors() {
		super();
		this.parent = new ControlFrame();
	}
	
	public SetupActors(ControlFrame parent) {
		super();
		this.parent = parent;
		this.defineStandardModels();
		this.initComponents();
	}
	
	// other methods
	
	private void initComponents() {
		
		this.setLayout(null);
        this.setBackground(java.awt.SystemColor.control);
        
    	int xLeft = 15;
    	int yTop = 5;
    	
        JLabel aux1Label = new JLabel("Expertise:", SwingConstants.LEFT);
		aux1Label.setBounds( xLeft, yTop, Const.LABEL_WIDTH, Const.LABEL_HEIGHT );
		aux1Label.setFont( new Font( "Arial", Font.BOLD, Const.CONTROL_FRAME_FONT_SIZE_TITLE ) );
		aux1Label.setForeground( Color.DARK_GRAY );
		this.add( aux1Label );
		
        for( int i = 0; i < Const.N_ACTOR_TYPES; i++) {
        	yTop = 35;
        	aux1Label = new JLabel("Team " + "ABCD".charAt(i), SwingConstants.CENTER);
        	aux1Label.setBounds(xLeft + 205*i, yTop, 175, Const.LABEL_HEIGHT);
        	aux1Label.setFont( new Font("Arial", Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL) );
			this.add( aux1Label );
        	for( int j = 0; j < Const.N_EXPERTISE_TOPICS; j++) {   
        		yTop = 70;
        		this.expertBarLabel[i][j] = new JLabel();
        		this.expertBarLabel[i][j].setBackground( Const.INKNOW_RED );
        		this.expertBarLabel[i][j].setOpaque( true );
        		this.add( this.expertBarLabel[i][j] );
        		//
        		yTop += 100;
        		char c = "MEIS".charAt(j);
        		aux1Label = new JLabel( "" + c , SwingConstants.CENTER );
        		aux1Label.setBounds(xLeft + 205*i + 45*j, yTop, 40, 40);	
        		aux1Label.setFont( new Font("Arial", Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL) );
        		switch (c) {
	        		case 'M': aux1Label.setToolTipText("Mechanics"); break;
	        		case 'E': aux1Label.setToolTipText("Electrical"); break;
	        		case 'I': aux1Label.setToolTipText("Internet"); break;
	        		case 'S': aux1Label.setToolTipText("Safety"); break;
	        		default:
        		}
        		this.add(aux1Label);
        		//
        		yTop += 40;
        		this.expertIncButton[i][j] = new JButton("+");
        		this.expertIncButton[i][j].setFont( new Font("Arial", Font.BOLD, 14) );
        		this.expertIncButton[i][j].setBounds(xLeft + 205*i + 45*j, yTop, 40, 40);	
        		this.expertIncButton[i][j].addActionListener(this);
    			this.add( this.expertIncButton[i][j] , 0 );
    			//
    			yTop += 45;
    			this.expertDecButton[i][j] = new JButton("-");
    			this.expertDecButton[i][j].setFont( new Font("Arial", Font.BOLD, 14) );
        		this.expertDecButton[i][j].setBounds(xLeft + 205*i + 45*j, yTop, 40, 40);	
        		this.expertDecButton[i][j].addActionListener(this);
    			this.add( this.expertDecButton[i][j] , 0 );
        	}
        }
        this.setExpertBarLabels();
        
        xLeft = 50;
		yTop = 330;
        
        aux1Label = new JLabel("Safety Curves:", SwingConstants.LEFT);
		aux1Label.setBounds(10, yTop, 150, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 16) );
		aux1Label.setForeground( Color.DARK_GRAY );
		this.add( aux1Label );
        

        xLeft = 60;
		yTop = 350;
		//
		aux1Label = new JLabel("(Safety) x (Expertise)", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft + 200*0 -50, yTop + 30, 200, 30);
		aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
		this.add( aux1Label );
		//
		this.safetyExpertiseButton =new JButton();
		this.safetyExpertiseButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyExpertiseModel.getPlotFilename() ));
		this.safetyExpertiseButton.setBounds(xLeft + 180*0, yTop + 60, 100, 100);	
		this.safetyExpertiseButton.addActionListener(this);
		this.add( this.safetyExpertiseButton, 0 );
		//
		aux1Label = new JLabel("(Safety) x (Light)", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft + 200*1-50, yTop + 30, 200, 30);
		aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
		this.add( aux1Label );
		//
		this.safetyLightButton =new JButton();
		this.safetyLightButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyLightModel.getPlotFilename() ));
		this.safetyLightButton.setBounds(xLeft + 200*1, yTop + 60, 100, 100);	
		this.safetyLightButton.addActionListener(this);
		this.add( this.safetyLightButton, 0 );
		//
		aux1Label = new JLabel("(Safety) x (Shift time)", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft + 200*2-50, yTop + 30, 200, 30);
		aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
		this.add( aux1Label );
		//
		this.safetyShifttimeButton =new JButton();
		this.safetyShifttimeButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyShifttimeModel.getPlotFilename() ));
		this.safetyShifttimeButton.setBounds(xLeft + 200*2, yTop + 60, 100, 100);	
		this.safetyShifttimeButton.addActionListener(this);
		this.add( this.safetyShifttimeButton, 0 );
        //---
		aux1Label = new JLabel("(Safety) x (Rate)", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft + 200*3-50, yTop + 30, 200, 30);
		aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
		this.add( aux1Label );
		//
		this.safetyRateButton =new JButton();
		this.safetyRateButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyRateModel.getPlotFilename() ));
		this.safetyRateButton.setBounds(xLeft + 200*3, yTop + 60, 100, 100);	
		this.safetyRateButton.addActionListener(this);
		this.add( this.safetyRateButton, 0 );
        //---
    	this.parent.getMainTabbedPane().addTab("Actors", this );
    	//
    	return;
	}
	
	// set expertise bars
	
	public void setExpertBarLabels() {
		int xLeft = 15;
		int yTop = 70;
		for(int i=0; i < Const.N_ACTOR_TYPES; i++) {
			for( int j = 0; j < Const.N_EXPERTISE_TOPICS; j++) {
				double aux = this.actorsExpertModels.get(i).getTopics()[j];
				this.expertBarLabel[i][j].setBounds( xLeft + 205*i + 45*j, yTop + 100-(int)(100*aux/Const.EXPERTISE_MAX), 40, (int)(100*aux/Const.EXPERTISE_MAX) );
			}
		}
	}
	
	// get buttons
	
	public JButton getSafetyExpertiseButton() {
		return this.safetyExpertiseButton;
	}

	public JButton getSafetyLightButton() {
		return this.safetyLightButton;
	}

	public JButton getSafetyShifttimeButton() {
		return this.safetyShifttimeButton;
	}

	public JButton getSafetyRateButton() {
		return this.safetyRateButton;
	}
	
	// set models

	public void setActorSafetyExpertiseModel(ExponentialModel actorSafetyExpertiseModel) {
		this.actorSafetyExpertiseModel = actorSafetyExpertiseModel;
		return;
	}

	public void setActorSafetyLightModel(ExponentialModel actorSafetyLightModel) {
		this.actorSafetyLightModel = actorSafetyLightModel;
		return;
	}

	public void setActorSafetyShifttimeModel(ExponentialModel actorSafetyShifttimeModel) {
		this.actorSafetyShifttimeModel = actorSafetyShifttimeModel;
		return;
	}
	
	public void setActorSafetyRateModel(ExponentialModel actorSafetyRateModel) {
		this.actorSafetyRateModel = actorSafetyRateModel;
		return;
	}
	
	// get std models

	public Vector<Expertise> getExpertiseStdModels() {
		return expertiseStdModels;
	}
	
	public Vector<ExponentialModel> getExponentialUpStdModels() {
		return exponentialUpStdModels;
	}

	public Vector<ExponentialModel> getExponentialDecayStdModels() {
		return exponentialDecayStdModels;
	}
	
	// get models
	
	public Vector<Expertise> getActorsExpertModels() {
		return actorsExpertModels;
	}
	
	public ExponentialModel getActorSafetyExpertiseModel() {
		return this.actorSafetyExpertiseModel;
	}
	
	public ExponentialModel getActorSafetyLightModel() {
		return this.actorSafetyLightModel;
	}
	
	public ExponentialModel getActorSafetyShifttimeModel() {
		return this.actorSafetyShifttimeModel;
	}
	
	public ExponentialModel getActorSafetyRateModel() {
		return actorSafetyRateModel;
	}

	
	public int getExpertiseModelIndexById(int id) {
		for (int i = 0; i < this.expertiseStdModels.size(); i++) {
			if (this.expertiseStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}
	
	// get std models index by id
	
	public int getExponentialUpStdModelIndexById(int id) {
		for (int i = 0; i < this.exponentialUpStdModels.size(); i++) {
			if (this.exponentialUpStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	public int getExponentialDecayStdModelIndexById(int id) {
		for (int i = 0; i < this.exponentialDecayStdModels.size(); i++) {
			if (this.exponentialDecayStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}
	
	// definition methods
	
	private void defineStandardModels() {
		// Expertise models M E I S
		this.expertiseStdModels.add(0, new Expertise(4345, Const.EXPERT_TYPE0_M, Const.EXPERT_TYPE0_E, Const.EXPERT_TYPE0_I, Const.EXPERT_TYPE0_S ) );
		this.expertiseStdModels.add(1, new Expertise(5315, Const.EXPERT_TYPE1_M, Const.EXPERT_TYPE1_E, Const.EXPERT_TYPE1_I, Const.EXPERT_TYPE1_S ) ); // Units X1 - 1st gen.
		this.expertiseStdModels.add(2, new Expertise(3534, Const.EXPERT_TYPE2_M, Const.EXPERT_TYPE2_E, Const.EXPERT_TYPE2_I, Const.EXPERT_TYPE2_S ) ); // Units X2 - 2nd gen.
		this.expertiseStdModels.add(3, new Expertise(1353, Const.EXPERT_TYPE3_M, Const.EXPERT_TYPE3_E, Const.EXPERT_TYPE3_I, Const.EXPERT_TYPE3_S ) ); // Units X3 - 3rd gen.
		// Actor Expertise models
		for (int i = 0; i < Const.N_ACTOR_TYPES; i++) {
			this.actorsExpertModels.add(i, this.expertiseStdModels.get( i ));
		}
		//
		// Sensitivity curve models :: efficiency x expertise - Unit B
		this.exponentialUpStdModels.add(0, new ExponentialModel(40, 1.00, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth100.png" ));
		this.exponentialUpStdModels.add(1, new ExponentialModel(41, 0.80, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth080.png" ));
		this.exponentialUpStdModels.add(2, new ExponentialModel(42, 0.66, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth066.png" ));
		this.exponentialUpStdModels.add(3, new ExponentialModel(43, 0.50, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth050.png" ));
		
		// Sensitivity curve models :: efficiency x expertise - Unit B
		this.exponentialDecayStdModels.add(0, new ExponentialModel(50, 1.00, Const.EXPONENTIAL_MODEL_DECAY, "pics/ModelDecay100.png" ));
		this.exponentialDecayStdModels.add(1, new ExponentialModel(51, 0.80, Const.EXPONENTIAL_MODEL_DECAY, "pics/ModelDecay080.png" ));
		this.exponentialDecayStdModels.add(2, new ExponentialModel(52, 0.66, Const.EXPONENTIAL_MODEL_DECAY, "pics/ModelDecay066.png" ));
		this.exponentialDecayStdModels.add(3, new ExponentialModel(53, 0.50, Const.EXPONENTIAL_MODEL_DECAY, "pics/ModelDecay050.png" ));
		
		// Actor models
		this.actorSafetyExpertiseModel = this.exponentialUpStdModels.get( Const.ACTOR_SAFETY_EXPERTISE_MODEL_INDEX );
		this.actorSafetyLightModel = this.exponentialUpStdModels.get( Const.ACTOR_SAFETY_LIGHT_MODEL_INDEX );
		this.actorSafetyShifttimeModel = this.exponentialDecayStdModels.get( Const.ACTOR_SAFETY_SHIFTTIME_MODEL_INDEX );
		this.actorSafetyRateModel = this.exponentialDecayStdModels.get( Const.ACTOR_SAFETY_RATE_MODEL_INDEX );
		return;
	}
	
	// listeners

	@Override
	public void actionPerformed(ActionEvent e) {
		for(int i=0; i < Const.N_ACTOR_TYPES; i++) {
			for( int j = 0; j < Const.N_EXPERTISE_TOPICS; j++) {
				if ( e.getSource() == this.expertIncButton[i][j]) {
					this.actorsExpertModels.get(i).incTechnologyLevel( j );
					this.setExpertBarLabels();
					this.parent.getSimulator().getPlant().updateExpertiseModels();
				} else if ( e.getSource() == this.expertDecButton[i][j] ) {
					this.actorsExpertModels.get(i).decTechnologyLevel( j );
					this.setExpertBarLabels();
					this.parent.getSimulator().getPlant().updateExpertiseModels();
				}
			}
		}
		if ( e.getSource() == this.safetyExpertiseButton ) {
			int index = this.getExponentialUpStdModelIndexById( this.actorSafetyExpertiseModel.getId() );
			index++;
			if (index >= this.exponentialUpStdModels.size()) index = 0;
			this.actorSafetyExpertiseModel = this.exponentialUpStdModels.get(index);
			this.safetyExpertiseButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyExpertiseModel.getPlotFilename() ));
			this.parent.getSimulator().getPlant().updateUnitsCurveModels();
		}
		if ( e.getSource() == this.safetyLightButton ) {
			int index = this.getExponentialUpStdModelIndexById( this.actorSafetyLightModel.getId() );
			index++;
			if (index >= this.exponentialUpStdModels.size()) index = 0;
			this.actorSafetyLightModel = this.exponentialUpStdModels.get(index);
			this.safetyLightButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyLightModel.getPlotFilename() ));
			this.parent.getSimulator().getPlant().updateUnitsCurveModels();
		}
		if ( e.getSource() == this.safetyShifttimeButton ) {
			int index = this.getExponentialDecayStdModelIndexById( this.actorSafetyShifttimeModel.getId() );
			index++;
			if (index >= this.exponentialDecayStdModels.size()) index = 0;
			this.actorSafetyShifttimeModel = this.exponentialDecayStdModels.get(index);
			this.safetyShifttimeButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyShifttimeModel.getPlotFilename() ));
			this.parent.getSimulator().getPlant().updateUnitsCurveModels();
		}
		if ( e.getSource() == this.safetyRateButton ) {
			int index = this.getExponentialDecayStdModelIndexById( this.actorSafetyRateModel.getId() );
			index++;
			if (index >= this.exponentialDecayStdModels.size()) index = 0;
			this.actorSafetyRateModel = this.exponentialDecayStdModels.get(index);
			this.safetyRateButton.setIcon( new javax.swing.ImageIcon( this.actorSafetyRateModel.getPlotFilename() ));
			this.parent.getSimulator().getPlant().updateUnitsCurveModels();
		}
		return;
	}

}
